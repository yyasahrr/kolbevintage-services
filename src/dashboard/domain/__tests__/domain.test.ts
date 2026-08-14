import { describe, expect, it } from "vitest";
import { applyAction } from "../actions";
import { generateDataset, SLA } from "../generate";
import {
  applyFilters,
  buildFunnel,
  buildIndex,
  buildInspectionQueue,
  buildSupplierPerformance,
  computeKpis,
} from "../selectors";
import { defaultFilters, previousBounds, rangeBounds, rangeForPreset } from "../filters";
import type { WholesaleDataset } from "../types";

const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);
const HOUR = 3_600_000;

function fresh(): WholesaleDataset {
  return generateDataset(NOW);
}

describe("dataset generation", () => {
  const data = fresh();

  it("meets the required sample-data volume", () => {
    expect(data.orders.length).toBeGreaterThanOrEqual(100);
    expect(data.suppliers.length).toBeGreaterThanOrEqual(8);
    expect(data.suppliers.length).toBeLessThanOrEqual(15);
    expect(data.customers.length).toBeGreaterThanOrEqual(20);
    expect(data.products.length).toBeGreaterThanOrEqual(50);
    expect(data.catalogues.length).toBeGreaterThan(1);
  });

  it("is deterministic for a fixed anchor", () => {
    const a = generateDataset(NOW);
    const b = generateDataset(NOW);
    expect(a.orders.length).toBe(b.orders.length);
    expect(a.orders[0].total).toBe(b.orders[0].total);
    expect(a.settlements.length).toBe(b.settlements.length);
  });

  it("spans roughly the requested history window", () => {
    const oldest = Math.min(...data.orders.map((o) => new Date(o.createdAt).getTime()));
    const days = (NOW - oldest) / (24 * HOUR);
    expect(days).toBeGreaterThan(60);
    expect(days).toBeLessThanOrEqual(121);
  });
});

describe("core domain invariants", () => {
  const data = fresh();
  const index = buildIndex(data);

  it("1 Order -> N Fulfillment Requests -> N Supplier Settlements", () => {
    const multi = data.orders.filter((o) => (index.fulfillmentsByOrder.get(o.id) ?? []).length > 1);
    expect(multi.length).toBeGreaterThan(0);

    for (const order of data.orders) {
      const fulfillments = index.fulfillmentsByOrder.get(order.id) ?? [];
      const settlements = index.settlementsByOrder.get(order.id) ?? [];
      // every settlement traces back to exactly one fulfillment of the same order
      for (const s of settlements) {
        const parent = fulfillments.find((f) => f.id === s.fulfillmentId);
        expect(parent).toBeDefined();
        expect(parent!.supplierId).toBe(s.supplierId);
      }
      // settlements never outnumber fulfillments
      expect(settlements.length).toBeLessThanOrEqual(fulfillments.length);
    }
  });

  it("splits an order's items across suppliers without losing value", () => {
    for (const order of data.orders) {
      const fulfillments = index.fulfillmentsByOrder.get(order.id) ?? [];
      if (fulfillments.length === 0) continue;
      const covered = fulfillments.reduce((s, f) => s + f.customerValue, 0);
      expect(covered).toBe(order.total);
    }
  });

  it("keeps Order Total !== Supplier Payable", () => {
    const withSettlements = data.orders.filter((o) => (index.settlementsByOrder.get(o.id) ?? []).length > 0);
    expect(withSettlements.length).toBeGreaterThan(0);
    for (const order of withSettlements) {
      const payable = (index.settlementsByOrder.get(order.id) ?? []).reduce((s, x) => s + x.payableAmount, 0);
      expect(payable).toBeLessThan(order.total);
    }
  });

  it("applies the settlement formula exactly", () => {
    for (const s of data.settlements) {
      const expected = Math.max(
        0,
        s.fulfilledAmount - s.commissionAmount - s.refundAmount - s.adjustmentTotal,
      );
      expect(s.payableAmount).toBe(expected);
      expect(s.adjustmentTotal).toBe(s.adjustments.reduce((a, x) => a + x.amount, 0));
    }
  });

  it("keeps the tiered commission inside 8-12%", () => {
    expect(data.commissions.length).toBeGreaterThan(0);
    for (const c of data.commissions) {
      expect(c.rate).toBeGreaterThanOrEqual(8);
      expect(c.rate).toBeLessThanOrEqual(12);
      expect(c.amount).toBe(Math.round((c.base * c.rate) / 100));
    }
  });

  it("never settles an order that still has an open dispute", () => {
    for (const dispute of data.disputes) {
      if (dispute.status === "resolved") continue;
      const settlements = index.settlementsByOrder.get(dispute.orderId) ?? [];
      expect(settlements.every((s) => s.status !== "paid")).toBe(true);
    }
  });

  it("freezes escrow for every open dispute", () => {
    for (const dispute of data.disputes) {
      if (dispute.status === "resolved") continue;
      const escrow = index.escrowByOrder.get(dispute.orderId);
      expect(escrow?.status).toBe("frozen");
    }
  });

  it("uses a fixed 72h inspection window after full delivery", () => {
    const inspected = data.orders.filter((o) => o.deliveredAt && o.inspectionEndsAt);
    expect(inspected.length).toBeGreaterThan(0);
    for (const o of inspected) {
      const span = (new Date(o.inspectionEndsAt!).getTime() - new Date(o.deliveredAt!).getTime()) / HOUR;
      expect(span).toBeCloseTo(SLA.inspectionHours, 5);
    }
  });

  it("only marks a fulfillment delayed when an SLA deadline has passed", () => {
    for (const f of data.fulfillments.filter((x) => x.delayed)) {
      const requested = new Date(f.requestedAt).getTime();
      expect(NOW).toBeGreaterThan(requested + SLA.acceptHours * HOUR);
    }
  });
});

describe("filters", () => {
  const data = fresh();
  const index = buildIndex(data);

  it("computes a previous window of equal length", () => {
    const f = defaultFilters(new Date(NOW));
    const current = rangeBounds(f);
    const previous = previousBounds(f);
    expect(previous.end).toBeLessThan(current.start);
    expect(previous.end - previous.start).toBeCloseTo(current.end - current.start, -3);
  });

  it("restricts orders to the selected supplier only", () => {
    const supplierId = data.suppliers[2].id;
    const filters = { ...defaultFilters(new Date(NOW)), ...rangeForPreset("90d", new Date(NOW)), preset: "90d" as const, supplierId };
    const filtered = applyFilters(data, index, filters);
    expect(filtered.orders.length).toBeGreaterThan(0);
    expect(filtered.fulfillments.every((f) => f.supplierId === supplierId)).toBe(true);
    expect(filtered.settlements.every((s) => s.supplierId === supplierId)).toBe(true);
    for (const o of filtered.orders) {
      expect((index.fulfillmentsByOrder.get(o.id) ?? []).some((f) => f.supplierId === supplierId)).toBe(true);
    }
  });

  it("restricts by order status", () => {
    const filters = {
      ...defaultFilters(new Date(NOW)),
      ...rangeForPreset("90d", new Date(NOW)),
      preset: "90d" as const,
      orderStatus: "completed" as const,
    };
    const filtered = applyFilters(data, index, filters);
    expect(filtered.orders.every((o) => o.status === "completed")).toBe(true);
  });

  it("narrows results as filters are added", () => {
    const base = { ...defaultFilters(new Date(NOW)), ...rangeForPreset("90d", new Date(NOW)), preset: "90d" as const };
    const wide = applyFilters(data, index, base);
    const narrow = applyFilters(data, index, { ...base, supplierId: data.suppliers[0].id });
    expect(narrow.orders.length).toBeLessThanOrEqual(wide.orders.length);
  });
});

describe("aggregations", () => {
  const data = fresh();
  const index = buildIndex(data);
  const filters = { ...defaultFilters(new Date(NOW)), ...rangeForPreset("90d", new Date(NOW)), preset: "90d" as const };
  const filtered = applyFilters(data, index, filters);

  it("produces a monotonically narrowing funnel", () => {
    const stages = buildFunnel(index, filtered);
    expect(stages).toHaveLength(10);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].count).toBeLessThanOrEqual(stages[0].count);
    }
    expect(stages[0].count).toBe(filtered.orders.length);
  });

  it("scores suppliers within 0..100 using equal weights", () => {
    const rows = buildSupplierPerformance(index, filtered);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.acceptanceRate).toBeLessThanOrEqual(100);
    }
    // sorted best first
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
  });

  it("classifies inspection urgency by remaining time", () => {
    const rows = buildInspectionQueue(index, filtered, NOW);
    for (const r of rows) {
      if (r.hoursRemaining <= 0) expect(r.urgency).toBe("expired");
      else if (r.hoursRemaining < 6) expect(r.urgency).toBe("critical");
      else if (r.hoursRemaining < 24) expect(r.urgency).toBe("soon");
      else expect(r.urgency).toBe("safe");
    }
  });

  it("computes KPIs consistently with the filtered slice", () => {
    const kpis = computeKpis(data, index, filtered);
    const gross = filtered.orders.reduce((s, o) => s + o.total, 0);
    expect(kpis.grossRevenue.value).toBe(gross);
    expect(kpis.averageOrderValue.value).toBeCloseTo(gross / filtered.orders.length, 5);
    expect(kpis.escrowBalance.value).toBeGreaterThanOrEqual(0);
  });
});

describe("catalogue and product management", () => {
  it("creates, updates and archives products", () => {
    const data = fresh();
    const created = applyAction(data, {
      type: "product/create",
      product: {
        name: "Test Overshirt",
        sku: "KV-TEST-1",
        catalogueId: data.catalogues[0].id,
        supplierId: data.suppliers[0].id,
        category: "linen",
        unitPrice: 1_500_000,
        moq: 24,
        stock: 100,
        status: "active",
      },
    }, NOW);
    expect(created.dataset.products.length).toBe(data.products.length + 1);

    const product = created.dataset.products[created.dataset.products.length - 1];
    const updated = applyAction(created.dataset, {
      type: "product/update",
      productId: product.id,
      patch: { unitPrice: 1_800_000 },
    }, NOW);
    expect(updated.dataset.products.find((p) => p.id === product.id)!.unitPrice).toBe(1_800_000);

    const deleted = applyAction(updated.dataset, { type: "product/delete", productId: product.id }, NOW);
    expect(deleted.dataset.products.find((p) => p.id === product.id)).toBeUndefined();
  });

  it("never hard-deletes a product that already has orders", () => {
    const data = fresh();
    const soldId = data.orders[0].items[0].productId;
    const result = applyAction(data, { type: "product/delete", productId: soldId }, NOW);
    const still = result.dataset.products.find((p) => p.id === soldId);
    expect(still).toBeDefined();
    expect(still!.status).toBe("discontinued");
    expect(result.tone).toBe("warning");
  });

  it("refuses to delete a catalogue that still holds products", () => {
    const data = fresh();
    const target = data.catalogues[0];
    const result = applyAction(data, { type: "catalogue/delete", catalogueId: target.id }, NOW);
    expect(result.tone).toBe("danger");
    expect(result.dataset.catalogues.find((c) => c.id === target.id)).toBeDefined();
  });

  it("creates and publishes a catalogue", () => {
    const data = fresh();
    const created = applyAction(data, {
      type: "catalogue/create",
      catalogue: { name: "Test Drop", season: "بهار", category: "linen", status: "draft" },
    }, NOW);
    const cat = created.dataset.catalogues[created.dataset.catalogues.length - 1];
    expect(cat.status).toBe("draft");
    const published = applyAction(created.dataset, {
      type: "catalogue/update",
      catalogueId: cat.id,
      patch: { status: "active" },
    }, NOW);
    expect(published.dataset.catalogues.find((c) => c.id === cat.id)!.status).toBe("active");
  });
});

describe("supplier onboarding", () => {
  it("ships seeded applications awaiting review", () => {
    const data = fresh();
    expect(data.applications.length).toBeGreaterThan(0);
    expect(data.applications.some((a) => a.status === "pending")).toBe(true);
  });

  it("submitting an application adds it to the review queue as pending", () => {
    const data = fresh();
    const result = applyAction(data, {
      type: "application/submit",
      application: {
        companyName: "New Partner Co",
        contactName: "علی رضایی",
        email: "a@b.com",
        phone: "09120000000",
        city: "تهران",
        specialty: "بافتنی",
        monthlyCapacity: 3000,
        yearsActive: 5,
      },
    }, NOW);
    const created = result.dataset.applications[result.dataset.applications.length - 1];
    expect(created.status).toBe("pending");
    expect(created.code).toMatch(/^APP-/);
    // an application is NOT a supplier until approved
    expect(result.dataset.suppliers.length).toBe(data.suppliers.length);
  });

  it("approving an application creates the supplier account", () => {
    const data = fresh();
    const pending = data.applications.find((a) => a.status === "pending")!;
    const result = applyAction(data, { type: "application/status", applicationId: pending.id, status: "approved" }, NOW);
    expect(result.dataset.suppliers.length).toBe(data.suppliers.length + 1);
    const app = result.dataset.applications.find((a) => a.id === pending.id)!;
    expect(app.status).toBe("approved");
    expect(app.createdSupplierId).toBeTruthy();
    const supplier = result.dataset.suppliers.find((s) => s.id === app.createdSupplierId)!;
    expect(supplier.name).toBe(pending.companyName);
    expect(supplier.commissionTier).toBeGreaterThanOrEqual(8);
    expect(supplier.commissionTier).toBeLessThanOrEqual(12);
  });

  it("rejecting an application records a reason and creates no supplier", () => {
    const data = fresh();
    const pending = data.applications.find((a) => a.status === "pending")!;
    const result = applyAction(
      data,
      { type: "application/status", applicationId: pending.id, status: "rejected", reason: "ظرفیت ناکافی" },
      NOW,
    );
    expect(result.dataset.suppliers.length).toBe(data.suppliers.length);
    const app = result.dataset.applications.find((a) => a.id === pending.id)!;
    expect(app.status).toBe("rejected");
    expect(app.rejectionReason).toBe("ظرفیت ناکافی");
  });

  it("does not approve the same application twice", () => {
    const data = fresh();
    const pending = data.applications.find((a) => a.status === "pending")!;
    const once = applyAction(data, { type: "application/status", applicationId: pending.id, status: "approved" }, NOW);
    const twice = applyAction(once.dataset, { type: "application/status", applicationId: pending.id, status: "approved" }, NOW);
    expect(twice.tone).toBe("warning");
    expect(twice.dataset.suppliers.length).toBe(once.dataset.suppliers.length);
  });

  it("adds a supplier directly without an application", () => {
    const data = fresh();
    const result = applyAction(data, {
      type: "supplier/create",
      supplier: { name: "Direct Partner", city: "تهران", specialty: "چرم", commissionTier: 9 },
    }, NOW);
    expect(result.dataset.suppliers.length).toBe(data.suppliers.length + 1);
    expect(result.dataset.applications.length).toBe(data.applications.length);
  });
});

describe("operational actions", () => {
  it("accepting a request advances the order without touching its total", () => {
    const data = fresh();
    const target = data.fulfillments.find((f) => f.status === "requested")!;
    const before = data.orders.find((o) => o.id === target.orderId)!;
    const { dataset } = applyAction(data, { type: "fulfillment/accept", fulfillmentId: target.id }, NOW);
    const after = dataset.orders.find((o) => o.id === target.orderId)!;
    expect(dataset.fulfillments.find((f) => f.id === target.id)!.status).toBe("accepted");
    expect(after.total).toBe(before.total);
    expect(dataset.timeline.length).toBeGreaterThan(data.timeline.length);
  });

  it("reassignment moves the request to a new supplier and resets its lifecycle", () => {
    const data = fresh();
    const target = data.fulfillments.find((f) => f.status === "requested")!;
    const newSupplier = data.suppliers.find((s) => s.id !== target.supplierId)!;
    const { dataset } = applyAction(
      data,
      { type: "fulfillment/reassign", fulfillmentId: target.id, supplierId: newSupplier.id },
      NOW,
    );
    const moved = dataset.fulfillments.find((f) => f.id === target.id)!;
    expect(moved.supplierId).toBe(newSupplier.id);
    expect(moved.status).toBe("requested");
    expect(moved.acceptedAt).toBeUndefined();
    // customer-visible order value is unchanged
    const order = dataset.orders.find((o) => o.id === target.orderId)!;
    expect(order.total).toBe(data.orders.find((o) => o.id === target.orderId)!.total);
  });

  it("blocks settlement payment while a dispute is open", () => {
    const data = fresh();
    const open = data.disputes.find((d) => d.status !== "resolved");
    if (!open) return;
    const settlement = data.settlements.find((s) => s.orderId === open.orderId);
    if (!settlement) return;
    const result = applyAction(data, { type: "settlement/pay", settlementId: settlement.id }, NOW);
    expect(result.tone).toBe("danger");
    expect(result.dataset.settlements.find((s) => s.id === settlement.id)!.status).not.toBe("paid");
  });

  it("refuses to release escrow that is frozen by a dispute", () => {
    const data = fresh();
    const frozen = data.escrows.find((e) => e.status === "frozen");
    if (!frozen) return;
    const result = applyAction(data, { type: "escrow/release", orderId: frozen.orderId }, NOW);
    expect(result.tone).toBe("danger");
    expect(result.dataset.escrows.find((e) => e.orderId === frozen.orderId)!.amountHeld).toBe(frozen.amountHeld);
  });

  it("resolving a dispute with a refund reduces supplier payable, not the order total", () => {
    const data = fresh();
    const open = data.disputes.find((d) => d.status !== "resolved" && data.settlements.some((s) => s.orderId === d.orderId));
    if (!open) return;
    const orderBefore = data.orders.find((o) => o.id === open.orderId)!;
    const payableBefore = data.settlements
      .filter((s) => s.orderId === open.orderId)
      .reduce((a, s) => a + s.payableAmount, 0);

    const { dataset } = applyAction(data, { type: "dispute/resolve", disputeId: open.id, resolution: "refund" }, NOW);

    const orderAfter = dataset.orders.find((o) => o.id === open.orderId)!;
    const payableAfter = dataset.settlements
      .filter((s) => s.orderId === open.orderId)
      .reduce((a, s) => a + s.payableAmount, 0);

    expect(dataset.disputes.find((d) => d.id === open.id)!.status).toBe("resolved");
    expect(orderAfter.total).toBe(orderBefore.total); // customer order total is immutable
    expect(orderAfter.refundTotal).toBeGreaterThan(orderBefore.refundTotal);
    expect(payableAfter).toBeLessThan(payableBefore);
    expect(dataset.escrows.find((e) => e.orderId === open.orderId)!.status).not.toBe("frozen");
  });

  it("paying a clean settlement marks it paid and stamps the timeline", () => {
    const data = fresh();
    const settlement = data.settlements.find(
      (s) => s.status !== "paid" && !data.disputes.some((d) => d.orderId === s.orderId && d.status !== "resolved"),
    )!;
    const { dataset, tone } = applyAction(data, { type: "settlement/pay", settlementId: settlement.id }, NOW);
    expect(tone).toBe("success");
    const after = dataset.settlements.find((s) => s.id === settlement.id)!;
    expect(after.status).toBe("paid");
    expect(after.paidAt).toBeTruthy();
    expect(after.payableAmount).toBe(settlement.payableAmount);
  });

  it("driving a fulfillment to delivery opens the inspection window", () => {
    const data = fresh();
    // find an order whose fulfillments are all one step from delivery
    const candidate = data.orders.find((o) => {
      const fs = data.fulfillments.filter((f) => f.orderId === o.id && f.status !== "rejected");
      return fs.length === 1 && fs[0].status === "shipped" && !o.deliveredAt;
    });
    if (!candidate) return;
    const f = data.fulfillments.find((x) => x.orderId === candidate.id && x.status === "shipped")!;
    const { dataset } = applyAction(data, { type: "fulfillment/advance", fulfillmentId: f.id }, NOW);
    const order = dataset.orders.find((o) => o.id === candidate.id)!;
    expect(dataset.fulfillments.find((x) => x.id === f.id)!.status).toBe("delivered");
    expect(order.inspectionEndsAt).toBeTruthy();
    const span = (new Date(order.inspectionEndsAt!).getTime() - new Date(order.deliveredAt!).getTime()) / HOUR;
    expect(span).toBeCloseTo(SLA.inspectionHours, 5);
  });
});
