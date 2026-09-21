import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProductionService } from "../src/modules/production/production.service";
import { ProductionDomainError, assertArtifactMetadata, assertChangeBoundary } from "../src/modules/production/production.logic";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_6_samples_changes_test";
const supplierId = "p56_samples_supplier";
const sellerId = "p56_samples_seller";
const ownerId = "p56_samples_owner";
const adminId = "p56_samples_admin";
const outsiderId = "p56_samples_outsider";
const jobId = "p56_samples_job";
const poId = "p56_samples_po";

let pool: Pool;
let production: ProductionService;

const orders = {
  async getProductionEligibility() {
    return { child: { id: poId, supplierId, sellerId, status: "confirmed", version: 0 }, targetUnits: 4, items: [] };
  },
};
const suppliers = {
  async getUserMemberships(userId: string) {
    return userId === ownerId ? [{ supplierId, sellerId, role: "owner" }] : [];
  },
};
const audit = { record: async () => "p56-samples-audit" };
const approvals = {};

async function seed() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ($1, $2, 'hash', 'salt', 'supplier', 'active'),
           ($3, $4, 'hash', 'salt', 'admin', 'active'),
           ($5, $6, 'hash', 'salt', 'supplier', 'active')
  `, [ownerId, `${ownerId}@test.invalid`, adminId, `${adminId}@test.invalid`, outsiderId, `${outsiderId}@test.invalid`]);
  await pool.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ($1, 'P56 Samples Supplier', 'P56 Samples Supplier', 'approved')`, [supplierId]);
  await pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'SUPPLIER', $2, 'P56 Samples Seller', 'active')`, [sellerId, supplierId]);
  await pool.query(`INSERT INTO supplier_member (id, supplier_id, user_id, role) VALUES ('p56_samples_member', $1, $2, 'owner')`, [supplierId, ownerId]);
  await pool.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, status, currency) VALUES ($1, 'P56-SAMPLE-PO', $2, $3, 'confirmed', 'IRR')`, [poId, sellerId, supplierId]);
  await pool.query(`INSERT INTO production_job (id, purchase_order_id, supplier_id, seller_id, purchase_order_version, status, target_units, requires_sample_approval, created_by) VALUES ($1, $2, $3, $4, 0, 'draft', 4, true, $5)`, [jobId, poId, supplierId, sellerId, ownerId]);
}

describe("Phase 5.6 samples, immutable evidence, and controlled changes", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    await seed();
    production = new ProductionService(drizzle(pool) as any, orders as any, suppliers as any, audit as any, approvals as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("keeps review history and creates a new immutable revision after requested changes", async () => {
    const supplier = { userId: ownerId, role: "supplier" as const };
    const admin = { userId: adminId, role: "admin" as const };
    const sample = await production.createSample(supplier, jobId, { sampleType: "final", title: "Final sample", idempotencyKey: "p56-sample-create" });
    const first = await production.submitSampleRevision(supplier, jobId, sample.sample.id, { specificationSnapshot: { seam: 1 }, idempotencyKey: "p56-sample-revision-1" });
    const changes = await production.reviewSample(admin, jobId, first.revision.id, { decision: "changes_requested", notes: "Add a measurement photo", idempotencyKey: "p56-sample-review-1" });
    expect(changes.sample.status).toBe("changes_requested");
    const second = await production.submitSampleRevision(supplier, jobId, sample.sample.id, { specificationSnapshot: { seam: 2, photo: true }, idempotencyKey: "p56-sample-revision-2" });
    expect(second.revision.revisionNumber).toBe(2);
    const approved = await production.reviewSample(admin, jobId, second.revision.id, { decision: "approved", idempotencyKey: "p56-sample-review-2" });
    expect(approved.sample.status).toBe("approved");
    await expect(pool.query("UPDATE production_sample_revision SET notes = 'tampered' WHERE id = $1", [second.revision.id])).rejects.toThrow(/phase_5_6_approved_sample_revision_immutable/);
    const reviews = await pool.query("SELECT decision FROM production_sample_review WHERE sample_revision_id = $1 ORDER BY created_at", [first.revision.id]);
    expect(reviews.rows.map((row) => row.decision)).toEqual(["changes_requested"]);
  });

  it("rejects raw bytes, unsafe object keys, and evidence outside the job", async () => {
    expect(() => assertArtifactMetadata({ artifactType: "image", mimeType: "image/png", objectKey: "production/p56/evidence.png", byteSize: 4, checksumSha256: "a".repeat(64), contentBase64: "large" })).toThrowError(/metadata only/);
    expect(() => assertArtifactMetadata({ artifactType: "image", mimeType: "image/png", objectKey: "production/p56/../escape.png", byteSize: 4, checksumSha256: "a".repeat(64) })).toThrowError(ProductionDomainError);
    const supplier = { userId: ownerId, role: "supplier" as const };
    await expect(production.registerArtifact(supplier, jobId, {
      artifactType: "image",
      mimeType: "image/png",
      objectKey: "production/p56/evidence.png",
      byteSize: 4,
      checksumSha256: "a".repeat(64),
      sampleRevisionId: "revision-from-another-job",
      idempotencyKey: "p56-artifact-outside",
    })).rejects.toMatchObject({ code: "SAMPLE_REVISION_NOT_FOUND" });
  });

  it("records operational changes but requires the owning Orders or Shipping decision for impact", async () => {
    expect(assertChangeBoundary({ changeType: "operational", ownerDomain: "production" })).toEqual({ changeType: "operational", ownerDomain: "production", commercialImpact: false, deliveryImpact: false });
    expect(() => assertChangeBoundary({ changeType: "commercial", ownerDomain: "production" })).toThrowError(/Orders or Offers/);
    expect(() => assertChangeBoundary({ changeType: "delivery", ownerDomain: "orders" })).toThrowError(/Shipping/);
    const supplier = { userId: ownerId, role: "supplier" as const };
    const admin = { userId: adminId, role: "admin" as const };
    const operational = await production.createChangeRequest(supplier, jobId, {
      changeType: "operational",
      ownerDomain: "production",
      reason: "Change the work-cell sequence",
      requestedFields: { workCell: "B" },
      idempotencyKey: "p56-operational-change",
    });
    const decided = await production.decideChangeRequest(admin, operational.change.id, { decision: "approved", idempotencyKey: "p56-operational-decision" });
    expect(decided.change.status).toBe("approved");
    await expect(production.createChangeRequest(supplier, jobId, {
      changeType: "delivery",
      ownerDomain: "production",
      reason: "Attempt to mutate the carrier deadline",
      idempotencyKey: "p56-delivery-boundary",
    })).rejects.toMatchObject({ code: "SHIPPING_OWNER_REQUIRED" });
    await expect(production.getJob({ userId: outsiderId, role: "supplier" }, jobId)).rejects.toMatchObject({ code: "SUPPLIER_OWNERSHIP_VIOLATION" });
  });
});
