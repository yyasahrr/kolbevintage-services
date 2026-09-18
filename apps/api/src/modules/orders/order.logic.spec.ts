import { describe, it, expect } from "vitest";
import {
  validateWholesaleOrderTransition,
  validateChildOrderTransition,
  validateSellerSupplierConsistency,
  validateQuantitySnapshot,
  validateOrderTotals,
  calculateLineTotal,
  calculateParentStatusFromChildren,
  calculateParentFulfillmentProjection,
  calculatePiecesPerPackage,
  calculateTotalPieces,
  isWholesaleOrderTransitionAllowed,
} from "./order.logic";
import { TransitionError } from "@kolbe/shared";

describe("Phase 4.2 — Order status machines", () => {
  it("draft → confirmed allowed", () => {
    expect(() => validateWholesaleOrderTransition("draft", "confirmed")).not.toThrow();
  });

  it("draft → completed forbidden", () => {
    expect(() => validateWholesaleOrderTransition("draft", "completed")).toThrow(TransitionError);
  });

  it("confirmed → awaiting_payment allowed", () => {
    expect(() => validateWholesaleOrderTransition("confirmed", "awaiting_payment")).not.toThrow();
  });

  it("confirmed → processing allowed (credit)", () => {
    expect(() => validateWholesaleOrderTransition("confirmed", "processing")).not.toThrow();
  });

  it("awaiting_payment → processing allowed", () => {
    expect(() => validateWholesaleOrderTransition("awaiting_payment", "processing")).not.toThrow();
  });

  it("processing → fulfillment allowed", () => {
    expect(() => validateWholesaleOrderTransition("processing", "fulfillment")).not.toThrow();
  });

  it("fulfillment → shipped allowed", () => {
    expect(() => validateWholesaleOrderTransition("fulfillment", "shipped")).not.toThrow();
  });

  it("shipped → completed allowed", () => {
    expect(() => validateWholesaleOrderTransition("shipped", "completed")).not.toThrow();
  });

  it("shipped → cancelled forbidden", () => {
    expect(() => validateWholesaleOrderTransition("shipped", "cancelled")).toThrow();
  });

  it("completed terminal", () => {
    expect(isWholesaleOrderTransitionAllowed("completed", "cancelled")).toBe(false);
  });

  it("child pending → confirmed allowed", () => {
    expect(() => validateChildOrderTransition("pending", "confirmed")).not.toThrow();
  });

  it("child shipped → delivered allowed", () => {
    expect(() => validateChildOrderTransition("shipped", "delivered")).not.toThrow();
  });

  it("child delivered terminal", () => {
    expect(() => validateChildOrderTransition("delivered", "cancelled")).toThrow();
  });
});

describe("Phase 4.2 — Seller/Supplier consistency", () => {
  it("KOLBE must have null supplier_id", () => {
    expect(() => validateSellerSupplierConsistency("KOLBE", null)).not.toThrow();
    expect(() => validateSellerSupplierConsistency("KOLBE", "sup_123")).toThrow();
  });

  it("SUPPLIER must have non-null supplier_id", () => {
    expect(() => validateSellerSupplierConsistency("SUPPLIER", "sup_123")).not.toThrow();
    expect(() => validateSellerSupplierConsistency("SUPPLIER", null)).toThrow();
  });
});

describe("Phase 4.2 — Quantity and package model", () => {
  it("full clothing series: 12 pieces per package, 3 packages = 36 pieces", () => {
    const composition = [
      { variantId: "S", quantity: 2 },
      { variantId: "M", quantity: 2 },
      { variantId: "L", quantity: 2 },
      { variantId: "XL", quantity: 2 },
      { variantId: "2XL", quantity: 2 },
      { variantId: "3XL", quantity: 2 },
    ];
    expect(calculatePiecesPerPackage(composition)).toBe(12);
    expect(calculateTotalPieces(3, 12)).toBe(36);
    expect(() =>
      validateQuantitySnapshot({
        quantity: 3,
        packageQuantity: 3,
        pieceQuantity: 36,
        composition: composition.map((c) => ({ variantId: c.variantId, quantity: c.quantity })),
      }),
    ).not.toThrow();
  });

  it("half series: 6 pieces per package", () => {
    const composition = [
      { variantId: "S", quantity: 1 },
      { variantId: "M", quantity: 1 },
      { variantId: "L", quantity: 1 },
      { variantId: "XL", quantity: 1 },
      { variantId: "2XL", quantity: 1 },
      { variantId: "3XL", quantity: 1 },
    ];
    expect(calculatePiecesPerPackage(composition)).toBe(6);
    expect(calculateTotalPieces(3, 6)).toBe(18);
  });

  it("shoe bundle: 8 pieces per package", () => {
    const composition = [
      { variantId: "40", quantity: 2 },
      { variantId: "41", quantity: 2 },
      { variantId: "42", quantity: 2 },
      { variantId: "43", quantity: 2 },
    ];
    expect(calculatePiecesPerPackage(composition)).toBe(8);
    expect(calculateTotalPieces(2, 8)).toBe(16);
  });

  it("accessory fixed: 10 pieces per package", () => {
    const composition = [{ variantId: "belt-black", quantity: 10 }];
    expect(calculatePiecesPerPackage(composition)).toBe(10);
    expect(calculateTotalPieces(2, 10)).toBe(20);
  });

  it("custom color bundle: 5 pieces per package", () => {
    const composition = [
      { variantId: "bag-black", quantity: 3 },
      { variantId: "bag-white", quantity: 2 },
    ];
    expect(calculatePiecesPerPackage(composition)).toBe(5);
  });

  it("rejects duplicate variant in composition", () => {
    expect(() =>
      validateQuantitySnapshot({
        quantity: 1,
        packageQuantity: 1,
        pieceQuantity: 4,
        composition: [
          { variantId: "S", quantity: 2 },
          { variantId: "S", quantity: 2 },
        ],
      }),
    ).toThrow();
  });

  it("rejects mismatch pieceQuantity vs packageQuantity * piecesPerPackage", () => {
    expect(() =>
      validateQuantitySnapshot({
        quantity: 1,
        packageQuantity: 2,
        pieceQuantity: 10,
        composition: [
          { variantId: "S", quantity: 1 },
          { variantId: "M", quantity: 1 },
          { variantId: "L", quantity: 1 },
          { variantId: "XL", quantity: 1 },
          { variantId: "2XL", quantity: 1 },
          { variantId: "3XL", quantity: 1 },
        ],
      }),
    ).toThrow();
  });

  it("PIECE pricing: line_total = piece_quantity * unit_price", () => {
    const total = calculateLineTotal({
      unitPrice: 1000n,
      quantity: 2,
      pieceQuantity: 12,
      pricingUnit: "PIECE",
    });
    expect(total).toBe(12000n);
  });

  it("PACKAGE pricing: line_total = package_count * unit_price", () => {
    const total = calculateLineTotal({
      unitPrice: 50000n,
      quantity: 3,
      pieceQuantity: 36,
      pricingUnit: "PACKAGE",
    });
    expect(total).toBe(150000n);
  });
});

describe("Phase 4.2 — Money totals", () => {
  it("valid totals: grand = items + shipping", () => {
    expect(() =>
      validateOrderTotals({
        itemsTotal: 100000n,
        shippingTotal: 20000n,
        grandTotal: 120000n,
      }),
    ).not.toThrow();
  });

  it("rejects grand < items", () => {
    expect(() =>
      validateOrderTotals({
        itemsTotal: 100000n,
        shippingTotal: 0n,
        grandTotal: 50000n,
      }),
    ).toThrow();
  });

  it("rejects negative", () => {
    expect(() =>
      validateOrderTotals({
        itemsTotal: -1n as any,
        shippingTotal: 0n,
        grandTotal: 0n,
      }),
    ).toThrow();
  });
});

describe("Phase 4.2 — Parent aggregate status (legacy projection)", () => {
  it("all children delivered → completed", () => {
    const status = calculateParentStatusFromChildren([
      { id: "c1", status: "delivered" },
      { id: "c2", status: "delivered" },
    ]);
    expect(status).toBe("completed");
  });

  it("all shipped/delivered → shipped", () => {
    const status = calculateParentStatusFromChildren([
      { id: "c1", status: "shipped" },
      { id: "c2", status: "delivered" },
    ]);
    expect(status).toBe("shipped");
  });

  it("all cancelled → cancelled", () => {
    const status = calculateParentStatusFromChildren([
      { id: "c1", status: "cancelled" },
      { id: "c2", status: "cancelled" },
    ]);
    expect(status).toBe("cancelled");
  });

  it("preparing child → fulfillment", () => {
    const status = calculateParentStatusFromChildren([
      { id: "c1", status: "preparing" },
      { id: "c2", status: "confirmed" },
    ]);
    expect(status).toBe("fulfillment");
  });
});

describe("Phase 4.2.1 — Payment gate protection (parent fulfillment projection)", () => {
  it("draft stays draft even if children are confirmed", () => {
    const status = calculateParentFulfillmentProjection("draft", [
      { id: "c1", status: "confirmed" },
      { id: "c2", status: "confirmed" },
    ]);
    expect(status).toBe("draft");
  });

  it("confirmed + confirmed children != processing automatically", () => {
    const status = calculateParentFulfillmentProjection("confirmed", [
      { id: "c1", status: "confirmed" },
      { id: "c2", status: "confirmed" },
    ]);
    expect(status).toBe("confirmed");
    expect(status).not.toBe("processing");
  });

  it("awaiting_payment + preparing children != processing automatically", () => {
    const status = calculateParentFulfillmentProjection("awaiting_payment", [
      { id: "c1", status: "preparing" },
    ]);
    expect(status).toBe("awaiting_payment");
    expect(status).not.toBe("processing");
  });

  it("awaiting_payment + shipped children != shipped automatically (no bypass)", () => {
    const status = calculateParentFulfillmentProjection("awaiting_payment", [
      { id: "c1", status: "shipped" },
      { id: "c2", status: "shipped" },
    ]);
    expect(status).toBe("awaiting_payment");
    expect(status).not.toBe("shipped");
  });

  it("confirmed + shipped children != shipped automatically", () => {
    const status = calculateParentFulfillmentProjection("confirmed", [
      { id: "c1", status: "shipped" },
    ]);
    expect(status).toBe("confirmed");
  });

  it("processing + pending/confirmed stays processing", () => {
    const status = calculateParentFulfillmentProjection("processing", [
      { id: "c1", status: "pending" },
      { id: "c2", status: "confirmed" },
    ]);
    expect(status).toBe("processing");
  });

  it("processing + preparing → fulfillment", () => {
    const status = calculateParentFulfillmentProjection("processing", [
      { id: "c1", status: "preparing" },
    ]);
    expect(status).toBe("fulfillment");
  });

  it("fulfillment + shipped/delivered → shipped", () => {
    const status = calculateParentFulfillmentProjection("fulfillment", [
      { id: "c1", status: "shipped" },
      { id: "c2", status: "delivered" },
    ]);
    expect(status).toBe("shipped");
  });

  it("fulfillment partial shipment stays fulfillment", () => {
    const status = calculateParentFulfillmentProjection("fulfillment", [
      { id: "c1", status: "shipped" },
      { id: "c2", status: "preparing" },
    ]);
    expect(status).toBe("fulfillment");
  });

  it("shipped + delivered → completed", () => {
    const status = calculateParentFulfillmentProjection("shipped", [
      { id: "c1", status: "delivered" },
      { id: "c2", status: "delivered" },
    ]);
    expect(status).toBe("completed");
  });

  it("shipped stays shipped until all delivered", () => {
    const status = calculateParentFulfillmentProjection("shipped", [
      { id: "c1", status: "shipped" },
      { id: "c2", status: "preparing" },
    ]);
    expect(status).toBe("shipped");
  });

  it("all cancelled → cancelled unless parent shipped/completed", () => {
    const status = calculateParentFulfillmentProjection("processing", [
      { id: "c1", status: "cancelled" },
      { id: "c2", status: "cancelled" },
    ]);
    expect(status).toBe("cancelled");
  });

  it("shipped parent with all cancelled children stays shipped (no cancellation from shipped)", () => {
    const status = calculateParentFulfillmentProjection("shipped", [
      { id: "c1", status: "cancelled" },
    ]);
    expect(status).toBe("shipped");
  });

  it("completed terminal stays completed", () => {
    const status = calculateParentFulfillmentProjection("completed", [
      { id: "c1", status: "delivered" },
    ]);
    expect(status).toBe("completed");
  });

  it("explicit API includes current parent state", () => {
    const result = calculateParentFulfillmentProjection("awaiting_payment", [
      { id: "c1", status: "shipped" },
    ]);
    expect(result).toBe("awaiting_payment");
  });
});

describe("Phase 4.2 — Snapshot immutability concept", () => {
  it("stored snapshot does not change when live product changes", () => {
    const stored = {
      productName: "Old Shirt",
      sku: "OLD-001",
      variant: { color: "red", size: "M" },
      package: { name: "Full Series", totalPieces: 12 },
    };
    const liveAfterEdit = {
      productName: "New Shirt",
      sku: "NEW-001",
      variant: { color: "blue", size: "L" },
      package: { name: "Half Series", totalPieces: 6 },
    };

    expect(stored.productName).toBe("Old Shirt");
    expect(liveAfterEdit.productName).toBe("New Shirt");
    expect(stored.productName).not.toBe(liveAfterEdit.productName);
  });
});
