import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@kolbe/database";
import { bootHarness, makeId, one, q, seedTwoSuppliers, type Harness, type SupplierContext } from "./helpers/phase-4-7-1.harness";

/**
 * Phase 4.7.5 — product compliance records, provenance documents and the
 * publication gate consumed by the catalog owner service.
 */
const TEST_DB = "kolbe_phase_4_7_5_product_compliance_test";

let h: Harness;
let ctx: SupplierContext;
let productCompliance: any;
let catalog: any;
let prodSupplier: string;
let prodKolbe: string;
let offerSupplier: string;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());
const admin = () => ({ userId: ctx.userAdmin, role: "admin" as const });
const PDF = Buffer.from("%PDF-1.4\n%provenance\n%%EOF\n").toString("base64");

async function withGateMode<T>(mode: string | undefined, work: () => Promise<T>): Promise<T> {
  const prev = process.env.KOLBE_PRODUCT_COMPLIANCE_GATE;
  if (mode === undefined) delete process.env.KOLBE_PRODUCT_COMPLIANCE_GATE;
  else process.env.KOLBE_PRODUCT_COMPLIANCE_GATE = mode;
  try {
    return await work();
  } finally {
    if (prev === undefined) delete process.env.KOLBE_PRODUCT_COMPLIANCE_GATE;
    else process.env.KOLBE_PRODUCT_COMPLIANCE_GATE = prev;
  }
}

async function seedApprovedProduct(ownerType: "KOLBE" | "SUPPLIER") {
  const id = makeId(`prod_${ownerType.toLowerCase()}`);
  await h.db.insert(schema.product).values({ id, name: `P ${id}`, slug: `p-${id}`, ownerType, status: "approved" } as any);
  return id;
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  const { ProductComplianceService } = await import("../src/modules/compliance/product-compliance.service");
  const { CatalogService } = await import("../src/modules/catalog/catalog.service");
  productCompliance = h.app.get(ProductComplianceService);
  catalog = h.app.get(CatalogService);
  prodSupplier = await seedApprovedProduct("SUPPLIER");
  prodKolbe = await seedApprovedProduct("KOLBE");
  offerSupplier = makeId("offerS");
  await h.db.insert(schema.sellerOffer).values({ id: offerSupplier, productId: prodSupplier, sellerId: ctx.sellerA, variantId: null, sku: `OFF-${offerSupplier}`, status: "draft", wholesalePrice: 1000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any } as any);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.5 — supplier declaration through the offers owner; verification is admin-only", () => {
  it("only members of the offer's supplier may declare; the declaration lands as pending_review regardless of any status the client sends", async () => {
    await api().put(`/api/v1/supplier/offers/${offerSupplier}/compliance`).set("Cookie", cookie(ctx.userBOwner, "supplier")).send({ originType: "imported" }).expect(403);
    await api().put(`/api/v1/supplier/offers/${offerSupplier}/compliance`).set("Cookie", cookie(ctx.userAWarehouse, "supplier")).send({ originType: "imported" }).expect(403);
    await api().put(`/api/v1/supplier/offers/offer_missing/compliance`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ originType: "imported" }).expect(404);

    const declared = await api()
      .put(`/api/v1/supplier/offers/${offerSupplier}/compliance`)
      .set("Cookie", cookie(ctx.userASales, "supplier"))
      .send({ originType: "imported", originCountry: "it", conditionClass: "vintage", manufacturerOrImporter: "Importer X", regulatoryIdentifiers: { importDeclaration: "TEST-ONLY" }, status: "verified", reviewedBy: ctx.userASales })
      .expect(200);
    expect(declared.body.record).toMatchObject({ productId: prodSupplier, sellerId: ctx.sellerA, status: "pending_review", originType: "imported", originCountry: "IT", conditionClass: "vintage" });
    expect(declared.body.record).not.toHaveProperty("reviewNotes");
    const row = await one(h.pool, `SELECT status, reviewed_by, declared_by FROM product_compliance_record WHERE product_id=$1`, [prodSupplier]);
    expect(row).toMatchObject({ status: "pending_review", reviewed_by: null, declared_by: ctx.userASales });

    const viaService = productCompliance.declare({ userId: ctx.userASales, role: "supplier" }, { productId: prodSupplier, sellerId: ctx.sellerB }, { originType: "domestic" });
    await expect(viaService).rejects.toMatchObject({ code: "COMPLIANCE_ACCESS_DENIED" });
    const read = await api().get(`/api/v1/supplier/offers/${offerSupplier}/compliance`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(200);
    expect(read.body.record.status).toBe("pending_review");
  });

  it("provenance documents: upload via the offer, private access only for the owning supplier or admin", async () => {
    const up = await api().post(`/api/v1/supplier/offers/${offerSupplier}/compliance/documents`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ documentType: "purchase_invoice", mimeType: "application/pdf", contentBase64: PDF, originalFilename: "invoice.pdf" }).expect(201);
    expect(up.body.document).not.toHaveProperty("objectKey");
    const docs = await api().get(`/api/v1/supplier/offers/${offerSupplier}/compliance/documents`).set("Cookie", cookie(ctx.userASales, "supplier")).expect(200);
    expect(docs.body.documents).toHaveLength(1);
    await api().post(`/api/v1/supplier/compliance/products/documents/${up.body.document.id}/access`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
    const access = await api().post(`/api/v1/supplier/compliance/products/documents/${up.body.document.id}/access`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(201);
    const file = await api().get(access.body.url).expect(200);
    expect(file.headers["content-type"]).toContain("application/pdf");
    const adminAccess = await api().post(`/api/v1/admin/compliance/products/documents/${up.body.document.id}/access`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(adminAccess.body.url).toBeTruthy();
    const review = await api().post(`/api/v1/admin/compliance/products/documents/${up.body.document.id}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reviewStatus: "approved", scanStatus: "clean" }).expect(201);
    expect(review.body.document.reviewStatus).toBe("approved");
  });

  it("admin review sets verified/rejected/restricted with an audit trail; supplier cannot reach the admin route", async () => {
    await api().post(`/api/v1/admin/compliance/products/${prodSupplier}/review`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ status: "verified" }).expect(403);
    const noReason = await api().post(`/api/v1/admin/compliance/products/${prodSupplier}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ status: "rejected" }).expect(400);
    expect(noReason.body.error).toBe("VALIDATION_ERROR");
    const verified = await api().post(`/api/v1/admin/compliance/products/${prodSupplier}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ status: "verified", reviewNotes: "documents checked" }).expect(201);
    expect(verified.body.record).toMatchObject({ status: "verified", reviewedBy: ctx.userAdmin });
    const audit = await one(h.pool, `SELECT count(*)::int AS c FROM audit_log WHERE action='product_compliance.verified' AND entity_id=$1`, [verified.body.record.id]);
    expect(audit.c).toBe(1);
    const missingProduct = await api().post(`/api/v1/admin/compliance/products/prod_missing/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ status: "verified" }).expect(404);
    expect(missingProduct.body.error).toBe("PRODUCT_COMPLIANCE_RECORD_NOT_FOUND");
  });
});

describe("Phase 4.7.5 — publication gate (catalog owner consumes canPublishProduct)", () => {
  it("external mode (default): rejected/restricted supplier products cannot be published; a record-less KOLBE product still publishes", async () => {
    await withGateMode(undefined, async () => {
      const kolbe = await catalog.transitionProductStatus(prodKolbe, "published", "admin");
      expect(kolbe.status).toBe("published");

      // supplier product currently verified → allowed
      const decision = await productCompliance.canPublishProduct({ productId: prodSupplier, ownerType: "SUPPLIER" });
      expect(decision).toMatchObject({ allowed: true, mode: "external", complianceStatus: "verified" });

      await productCompliance.review(admin(), prodSupplier, { status: "rejected", reviewNotes: "counterfeit suspicion" });
      await expect(catalog.transitionProductStatus(prodSupplier, "published", "admin")).rejects.toMatchObject({ code: "PRODUCT_COMPLIANCE_BLOCKED", status: 409 });
      expect((await one(h.pool, `SELECT status FROM product WHERE id=$1`, [prodSupplier])).status).toBe("approved");

      // a supplier cannot lift the block by re-declaring
      await api().put(`/api/v1/supplier/offers/${offerSupplier}/compliance`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ originType: "domestic" }).expect(200);
      const redeclared = await productCompliance.canPublishProduct({ productId: prodSupplier, ownerType: "SUPPLIER" });
      expect(redeclared).toMatchObject({ allowed: true, complianceStatus: "pending_review" }); // external mode only blocks rejected/restricted
      await productCompliance.review(admin(), prodSupplier, { status: "restricted", reviewNotes: "regulatory restriction" });
      await expect(api().put(`/api/v1/supplier/offers/${offerSupplier}/compliance`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ originType: "domestic" }).expect(409));

      // restricted blocks even first-party
      const kolbeRestricted = await seedApprovedProduct("KOLBE");
      await productCompliance.review(admin(), kolbeRestricted, { status: "restricted", reviewNotes: "restricted category" });
      await expect(catalog.transitionProductStatus(kolbeRestricted, "published", "admin")).rejects.toMatchObject({ code: "PRODUCT_COMPLIANCE_BLOCKED" });
    });
  });

  it("strict mode requires `verified` for supplier products; off mode never blocks (documented emergency switch)", async () => {
    const pending = await seedApprovedProduct("SUPPLIER");
    await productCompliance.review(admin(), pending, { status: "pending_review" });
    await withGateMode("strict", async () => {
      const d = await productCompliance.canPublishProduct({ productId: pending, ownerType: "SUPPLIER" });
      expect(d).toMatchObject({ allowed: false, mode: "strict", reasonCode: "PRODUCT_COMPLIANCE_VERIFICATION_REQUIRED" });
      await expect(catalog.transitionProductStatus(pending, "published", "admin")).rejects.toMatchObject({ code: "PRODUCT_COMPLIANCE_VERIFICATION_REQUIRED" });
      const missing = await seedApprovedProduct("SUPPLIER");
      expect(await productCompliance.canPublishProduct({ productId: missing, ownerType: "SUPPLIER" })).toMatchObject({ allowed: false, complianceStatus: "missing" });
      // first-party unaffected unless restricted
      expect(await productCompliance.canPublishProduct({ productId: missing, ownerType: "KOLBE" })).toMatchObject({ allowed: true });
    });
    await withGateMode("off", async () => {
      expect(await productCompliance.canPublishProduct({ productId: prodSupplier, ownerType: "SUPPLIER" })).toMatchObject({ allowed: true, mode: "off", complianceStatus: "restricted" });
    });
    // the gate never mutated catalog data by itself
    const rows = await q(h.pool, `SELECT status FROM product WHERE id IN ($1, $2)`, [pending, prodSupplier]);
    expect(rows.every((r: any) => r.status === "approved")).toBe(true);
  });

  it("DB-level: status consistency check prevents a 'verified' record without reviewer facts", async () => {
    const orphan = await seedApprovedProduct("SUPPLIER");
    await expect(q(h.pool, `INSERT INTO product_compliance_record (id, product_id, status) VALUES ($1, $2, 'verified')`, [makeId("pcr"), orphan])).rejects.toThrow(/product_compliance_record_verified_consistency/);
  });
});
