import { describe, expect, it } from "vitest";
import {
  resolvePrice,
  hashAcceptedTerms,
  canonicalStringify,
  calculatePiecesPerPackage,
  calculateTotalPieces,
  validateMultiRequestBatch,
  type AcceptedTermsSnapshot,
  type PricingTier,
  type Offer,
  type Package,
} from "./pricing.logic";

describe("Phase 4.2.2 — Pricing resolver", () => {
  const baseOffer: Offer = {
    id: "offer_1",
    productId: "prod_1",
    sellerId: "seller_1",
    wholesalePrice: 10000n,
    currency: "IRR",
    moq: 1,
    moqUnit: "PIECE",
    pricingUnit: "PIECE",
  };

  it("PIECE pricing: quantity = pieceQuantity, lineTotal = quantity * unitPrice", () => {
    const result = resolvePrice({
      offer: baseOffer,
      variantId: "var_1",
      packageId: null,
      package: null,
      quantity: 5,
      pricingTiers: [],
    });
    expect(result.pieceQuantity).toBe(5);
    expect(result.quantityInPricingUnit).toBe(5);
    expect(result.unitPrice).toBe(10000n);
    expect(result.lineTotal).toBe(50000n);
    expect(result.pricingUnit).toBe("PIECE");
  });

  it("PACKAGE pricing: pieceQuantity = quantity * piecesPerPackage", () => {
    const pkg: Package = {
      id: "pkg_1",
      offerId: "offer_1",
      packageType: "SIZE_RUN",
      name: "Full Series",
      totalPieces: 12,
      composition: [
        { variantId: "var_s", quantity: 3 },
        { variantId: "var_m", quantity: 3 },
        { variantId: "var_l", quantity: 3 },
        { variantId: "var_xl", quantity: 3 },
      ],
    };
    const offerPkg: Offer = { ...baseOffer, moqUnit: "PACKAGE", pricingUnit: "PACKAGE", wholesalePrice: 120000n };
    const result = resolvePrice({
      offer: offerPkg,
      variantId: null,
      packageId: "pkg_1",
      package: pkg,
      quantity: 2,
      pricingTiers: [],
    });
    // pieces_per_package = 12, quantity 2 => 24 pieces
    expect(result.pieceQuantity).toBe(24);
    expect(result.quantityInPricingUnit).toBe(2);
    expect(result.lineTotal).toBe(240000n);
  });

  it("Full series 12/pack 3→36, Half 6/pack 3→18, Shoes 8/pack 2→16 examples", () => {
    // Full series: 12 total, pack of 3 => 36? Actually per spec example: Full series 12/pack 3→36 means 12 variants? Let's test formula
    const fullSeriesComposition = [
      { variantId: "s", quantity: 3 },
      { variantId: "m", quantity: 3 },
      { variantId: "l", quantity: 3 },
      { variantId: "xl", quantity: 3 },
    ]; // sum 12
    expect(calculatePiecesPerPackage(fullSeriesComposition)).toBe(12);
    expect(calculateTotalPieces(3, 12)).toBe(36);

    const halfSeries = [
      { variantId: "s", quantity: 2 },
      { variantId: "m", quantity: 2 },
      { variantId: "l", quantity: 2 },
    ]; // sum 6
    expect(calculatePiecesPerPackage(halfSeries)).toBe(6);
    expect(calculateTotalPieces(3, 6)).toBe(18);

    const shoes = [
      { variantId: "42", quantity: 2 },
      { variantId: "43", quantity: 2 },
      { variantId: "44", quantity: 2 },
      { variantId: "45", quantity: 2 },
    ]; // sum 8
    expect(calculatePiecesPerPackage(shoes)).toBe(8);
    expect(calculateTotalPieces(2, 8)).toBe(16);
  });

  it("BOX/CARTON have no universal 5/20 multiplier — explicit recipe only", () => {
    const boxComposition = [
      { variantId: "v1", quantity: 5 },
      { variantId: "v2", quantity: 5 },
    ]; // sum 10, not 5*packagePieces
    const pkg: Package = {
      id: "box_pkg",
      offerId: "offer_box",
      packageType: "BOX",
      name: "Box 10 pcs",
      totalPieces: 10,
      composition: boxComposition,
    };
    const offerBox: Offer = { ...baseOffer, moqUnit: "BOX", pricingUnit: "BOX", wholesalePrice: 50000n };
    const result = resolvePrice({
      offer: offerBox,
      variantId: null,
      packageId: "box_pkg",
      package: pkg,
      quantity: 1,
      pricingTiers: [],
    });
    expect(result.pieceQuantity).toBe(10); // not 5*? No universal multiplier
    expect(result.quantityInPricingUnit).toBe(1);

    const cartonComposition = [
      { variantId: "v1", quantity: 10 },
      { variantId: "v2", quantity: 10 },
    ]; // sum 20, but not forced 20*packagePieces
    const cartonPkg: Package = {
      id: "carton_pkg",
      offerId: "offer_carton",
      packageType: "CARTON",
      name: "Carton 20 pcs",
      totalPieces: 20,
      composition: cartonComposition,
    };
    const offerCarton: Offer = { ...baseOffer, moqUnit: "CARTON", pricingUnit: "CARTON", wholesalePrice: 100000n };
    const resultCarton = resolvePrice({
      offer: offerCarton,
      variantId: null,
      packageId: "carton_pkg",
      package: cartonPkg,
      quantity: 1,
      pricingTiers: [],
    });
    expect(resultCarton.pieceQuantity).toBe(20);
  });

  it("pricing tier deterministic: highest minQuantity wins, overlapping same min ambiguous", () => {
    const tiers: PricingTier[] = [
      { id: "tier_1", offerId: "offer_1", minQuantity: 1, maxQuantity: 9, unitPrice: 10000n, currency: "IRR", moqUnit: "PIECE", pricingUnit: "PIECE" },
      { id: "tier_2", offerId: "offer_1", minQuantity: 10, maxQuantity: 49, unitPrice: 9000n, currency: "IRR", moqUnit: "PIECE", pricingUnit: "PIECE" },
      { id: "tier_3", offerId: "offer_1", minQuantity: 50, maxQuantity: null, unitPrice: 8000n, currency: "IRR", moqUnit: "PIECE", pricingUnit: "PIECE" },
    ];

    const r1 = resolvePrice({ offer: baseOffer, variantId: "var", packageId: null, package: null, quantity: 5, pricingTiers: tiers });
    expect(r1.pricingTierId).toBe("tier_1");
    expect(r1.unitPrice).toBe(10000n);

    const r2 = resolvePrice({ offer: baseOffer, variantId: "var", packageId: null, package: null, quantity: 15, pricingTiers: tiers });
    expect(r2.pricingTierId).toBe("tier_2");
    expect(r2.unitPrice).toBe(9000n);

    const r3 = resolvePrice({ offer: baseOffer, variantId: "var", packageId: null, package: null, quantity: 100, pricingTiers: tiers });
    expect(r3.pricingTierId).toBe("tier_3");
    expect(r3.unitPrice).toBe(8000n);
  });

  it("overlapping tiers with same min and different price throw", () => {
    const overlapping: PricingTier[] = [
      { id: "t1", offerId: "o1", minQuantity: 10, maxQuantity: 20, unitPrice: 9000n, currency: "IRR", moqUnit: "PIECE", pricingUnit: "PIECE" },
      { id: "t2", offerId: "o1", minQuantity: 10, maxQuantity: 30, unitPrice: 8000n, currency: "IRR", moqUnit: "PIECE", pricingUnit: "PIECE" },
    ];
    expect(() =>
      resolvePrice({ offer: baseOffer, variantId: "var", packageId: null, package: null, quantity: 15, pricingTiers: overlapping }),
    ).toThrow(/Ambiguous/);
  });

  it("int money, no float, bigint", () => {
    const result = resolvePrice({
      offer: { ...baseOffer, wholesalePrice: 123456789n },
      variantId: "var",
      packageId: null,
      package: null,
      quantity: 3,
      pricingTiers: [],
    });
    expect(typeof result.unitPrice).toBe("bigint");
    expect(typeof result.lineTotal).toBe("bigint");
    expect(result.lineTotal).toBe(370370367n);
  });
});

describe("Phase 4.2.2 — Terms hash deterministic", () => {
  const baseSnapshot: AcceptedTermsSnapshot = {
    requestVersion: 0,
    productId: "prod_1",
    offerId: "offer_1",
    sellerId: "seller_1",
    supplierId: "sup_1",
    variantId: "var_1",
    packageId: null,
    quantity: 5,
    saleUnit: "PIECE",
    pricingUnit: "PIECE",
    pricingTierId: null,
    unitPrice: "10000",
    currency: "IRR",
    product: { id: "prod_1", name: "Product 1" },
    variant: { id: "var_1", sku: "SKU-1", attributes: {} },
    seller: { id: "seller_1", type: "KOLBE", displayName: "KOLBE", supplierId: "sup_1" },
    package: null,
    pieceQuantity: 5,
    lineTotal: "50000",
  };

  it("same snapshot → same hash", () => {
    const h1 = hashAcceptedTerms(baseSnapshot);
    const h2 = hashAcceptedTerms({ ...baseSnapshot });
    expect(h1).toBe(h2);
  });

  it("price change → different hash", () => {
    const h1 = hashAcceptedTerms(baseSnapshot);
    const h2 = hashAcceptedTerms({ ...baseSnapshot, unitPrice: "20000", lineTotal: "100000" });
    expect(h1).not.toBe(h2);
  });

  it("composition change → different hash", () => {
    const withPkg: AcceptedTermsSnapshot = {
      ...baseSnapshot,
      packageId: "pkg_1",
      variantId: null,
      saleUnit: "PACKAGE",
      pricingUnit: "PACKAGE",
      product: { id: "prod_1", name: "Product 1" },
      variant: null,
      seller: { id: "seller_1", type: "KOLBE", displayName: "KOLBE", supplierId: "sup_1" },
      package: {
        id: "pkg_1",
        type: "SIZE_RUN",
        name: "Full Series",
        piecesPerPackage: 12,
        composition: [
          { variantId: "var_s", quantity: 3 },
          { variantId: "var_m", quantity: 3 },
        ],
      },
      pieceQuantity: 12,
      lineTotal: "120000",
      unitPrice: "120000",
    };
    const h1 = hashAcceptedTerms(withPkg);
    const withPkgChanged: AcceptedTermsSnapshot = {
      ...withPkg,
      package: {
        id: "pkg_1",
        type: "SIZE_RUN",
        name: "Full Series",
        piecesPerPackage: 12,
        composition: [
          { variantId: "var_s", quantity: 2 }, // changed
          { variantId: "var_m", quantity: 3 },
        ],
      },
      pieceQuantity: 10,
    };
    const h2 = hashAcceptedTerms(withPkgChanged);
    expect(h1).not.toBe(h2);
  });

  it("canonical serialization stable ordering", () => {
    const snap1: any = { b: 2, a: 1, c: { z: 3, y: 2 } };
    const snap2: any = { a: 1, c: { y: 2, z: 3 }, b: 2 };
    expect(canonicalStringify(snap1)).toBe(canonicalStringify(snap2));
  });
});

describe("Phase 4.2.2 — Multi-request batch validation", () => {
  const now = new Date();
  const future = new Date(now.getTime() + 86400000);

  const makeReq = (overrides: Partial<any> = {}) => ({
    id: `req_${Math.random()}`,
    vipAccountId: "acc_1",
    buyerUserId: "user_1",
    status: "accepted",
    acceptedTermsSnapshot: {
      requestVersion: 0,
      productId: "prod_1",
      offerId: "offer_1",
      sellerId: "seller_1",
      supplierId: "sup_1",
      variantId: "var_1",
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "1000",
      currency: "IRR",
      product: { id: "prod_1", name: "Prod 1" },
      variant: { id: "var_1", sku: "SKU-1", attributes: {} },
      seller: { id: "seller_1", type: "KOLBE", displayName: "KOLBE", supplierId: "sup_1" },
      package: null,
      pieceQuantity: 1,
      lineTotal: "1000",
    } as AcceptedTermsSnapshot,
    acceptedTermsHash: "",
    version: 1,
    currency: "IRR",
    acceptanceExpiresAt: future,
    sellerId: "seller_1",
    alreadyLinked: false,
    ...overrides,
  });

  it("valid batch same account, same buyer, different sellers allowed", () => {
    const r1 = makeReq({ id: "req_1", sellerId: "seller_a" });
    const r2 = makeReq({ id: "req_2", sellerId: "seller_b" });
    const r3 = makeReq({ id: "req_3", sellerId: "seller_kolbe", supplierId: null });
    // compute hashes
    r1.acceptedTermsHash = hashAcceptedTerms(r1.acceptedTermsSnapshot);
    r2.acceptedTermsSnapshot = { ...r2.acceptedTermsSnapshot, sellerId: "seller_b", offerId: "offer_b" };
    r2.acceptedTermsHash = hashAcceptedTerms(r2.acceptedTermsSnapshot);
    r3.acceptedTermsSnapshot = { ...r3.acceptedTermsSnapshot, sellerId: "seller_kolbe", supplierId: null, offerId: "offer_kolbe" };
    r3.acceptedTermsHash = hashAcceptedTerms(r3.acceptedTermsSnapshot);

    expect(() => validateMultiRequestBatch([r1, r2, r3])).not.toThrow();
  });

  it("invalid: different VIP accounts reject atomically", () => {
    const r1 = makeReq({ id: "req_1", vipAccountId: "acc_1" });
    const r2 = makeReq({ id: "req_2", vipAccountId: "acc_2" });
    r1.acceptedTermsHash = hashAcceptedTerms(r1.acceptedTermsSnapshot);
    r2.acceptedTermsHash = hashAcceptedTerms(r2.acceptedTermsSnapshot);
    expect(() => validateMultiRequestBatch([r1, r2])).toThrow(/Account mismatch/);
  });

  it("invalid: different buyers reject", () => {
    const r1 = makeReq({ id: "req_1", buyerUserId: "user_1" });
    const r2 = makeReq({ id: "req_2", buyerUserId: "user_2" });
    r1.acceptedTermsHash = hashAcceptedTerms(r1.acceptedTermsSnapshot);
    r2.acceptedTermsHash = hashAcceptedTerms(r2.acceptedTermsSnapshot);
    expect(() => validateMultiRequestBatch([r1, r2])).toThrow(/Buyer mismatch/);
  });

  it("invalid: expired acceptance", () => {
    const past = new Date(now.getTime() - 1000);
    const r1 = makeReq({ id: "req_1", acceptanceExpiresAt: past });
    r1.acceptedTermsHash = hashAcceptedTerms(r1.acceptedTermsSnapshot);
    expect(() => validateMultiRequestBatch([r1])).toThrow(/expired/);
  });

  it("invalid: currency mismatch", () => {
    const r1 = makeReq({ id: "req_1", currency: "IRR" });
    const r2 = makeReq({ id: "req_2", currency: "USD" });
    r1.acceptedTermsHash = hashAcceptedTerms(r1.acceptedTermsSnapshot);
    r2.acceptedTermsSnapshot = { ...r2.acceptedTermsSnapshot, currency: "USD" };
    r2.acceptedTermsHash = hashAcceptedTerms(r2.acceptedTermsSnapshot);
    expect(() => validateMultiRequestBatch([r1, r2])).toThrow(/Currency mismatch/);
  });
});
