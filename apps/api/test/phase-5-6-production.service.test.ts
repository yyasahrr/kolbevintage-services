import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProductionService } from "../src/modules/production/production.service";
import { ProductionDomainError } from "../src/modules/production/production.logic";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_6_production_service_test";
const supplierId = "p56_service_supplier";
const sellerId = "p56_service_seller";
const ownerId = "p56_service_owner";
const outsiderId = "p56_service_outsider";

let pool: Pool;
let production: ProductionService;

const contexts: Record<string, { targetUnits: number }> = {
  p56_service_po: { targetUnits: 6 },
  p56_service_po_2: { targetUnits: 6 },
};

const orders = {
  async getProductionEligibility({ childOrderId }: { childOrderId: string }) {
    const context = contexts[childOrderId];
    if (!context) throw new Error(`unexpected purchase order ${childOrderId}`);
    return {
      child: { id: childOrderId, supplierId, sellerId, status: "confirmed", version: 0 },
      targetUnits: context.targetUnits,
      items: [],
    };
  },
};

const suppliers = {
  async getUserMemberships(userId: string) {
    return userId === ownerId ? [{ supplierId, sellerId, role: "owner" }] : [];
  },
};
const audit = { record: async () => "p56-service-audit" };
const approvals = {};

async function insertBase() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ($1, $2, 'hash', 'salt', 'supplier', 'active'),
           ($3, $4, 'hash', 'salt', 'supplier', 'active'),
           ('p56_service_admin', 'p56-service-admin@test.invalid', 'hash', 'salt', 'admin', 'active')
  `, [ownerId, `${ownerId}@test.invalid`, outsiderId, `${outsiderId}@test.invalid`]);
  await pool.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ($1, 'P56 Service Supplier', 'P56 Service Supplier', 'approved')`, [supplierId]);
  await pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'SUPPLIER', $2, 'P56 Service Seller', 'active')`, [sellerId, supplierId]);
  await pool.query(`INSERT INTO supplier_member (id, supplier_id, user_id, role) VALUES ('p56_service_member', $1, $2, 'owner')`, [supplierId, ownerId]);
  await pool.query(`
    INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, status, currency)
    VALUES ('p56_service_po', 'P56-SERVICE-1', $1, $2, 'confirmed', 'IRR'),
           ('p56_service_po_2', 'P56-SERVICE-2', $1, $2, 'confirmed', 'IRR')
  `, [sellerId, supplierId]);
}

describe("Phase 5.6 ProductionService ownership, idempotency and races", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    await insertBase();
    const db = drizzle(pool);
    production = new ProductionService(db as any, orders as any, suppliers as any, audit as any, approvals as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("uses canonical child-order eligibility, supplier isolation, and replay-safe job creation", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const first = await production.createJob(actor, { purchaseOrderId: "p56_service_po", idempotencyKey: "p56-create-job-1" });
    const replay = await production.createJob(actor, { purchaseOrderId: "p56_service_po", idempotencyKey: "p56-create-job-1" });
    expect(first.job.id).toBe(replay.job.id);
    expect(replay.replayed).toBe(true);
    await expect(production.getJob({ userId: outsiderId, role: "supplier" }, first.job.id)).rejects.toMatchObject({ code: "SUPPLIER_OWNERSHIP_VIOLATION" });
  });

  it("runs the final-sample review gate and replays the same review command", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const jobs = await production.listJobs(actor, { page: 1, limit: 10 });
    const job = jobs.items.find((candidate: any) => candidate.purchaseOrderId === "p56_service_po");
    expect(job).toBeTruthy();
    const sample = await production.createSample(actor, job.id, { sampleType: "final", title: "P56 final", idempotencyKey: "p56-sample-create-1" });
    const submitted = await production.submitSampleRevision(actor, job.id, sample.sample.id, { specificationSnapshot: { stitchCount: 10 }, notes: "ready", idempotencyKey: "p56-sample-submit-1" });
    const admin = { userId: "p56_service_admin", role: "admin" as const };
    const review = await production.reviewSample(admin, job.id, submitted.revision.id, { decision: "approved", idempotencyKey: "p56-sample-review-1" });
    expect(review.sample.status).toBe("approved");
    const replay = await production.reviewSample(admin, job.id, submitted.revision.id, { decision: "approved", idempotencyKey: "p56-sample-review-1" });
    expect(replay.replayed).toBe(true);
  });

  it("plans capacity with a PostgreSQL advisory lock and rejects the losing race", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const secondJob = await production.createJob(actor, { purchaseOrderId: "p56_service_po_2", idempotencyKey: "p56-create-job-2" });
    const start = new Date(Date.now() + 60_000);
    const end = new Date(Date.now() + 24 * 60 * 60_000);
    const period = await production.createCapacityPeriod(actor, { startsAt: start.toISOString(), endsAt: end.toISOString(), declaredUnits: 10 });
    const firstJob = (await production.listJobs(actor, { page: 1, limit: 10 })).items.find((job: any) => job.purchaseOrderId === "p56_service_po");
    expect(firstJob).toBeTruthy();
    const attempts = await Promise.allSettled([
      production.planJob(actor, firstJob.id, { capacityPeriodId: period.id, idempotencyKey: "p56-plan-race-1" }),
      production.planJob(actor, secondJob.job.id, { capacityPeriodId: period.id, idempotencyKey: "p56-plan-race-2" }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: expect.stringMatching(/CAPACITY_INSUFFICIENT|CAPACITY_CLOSURE_CONFLICT/) });
    const replay = await production.planJob(actor, firstJob.id, { capacityPeriodId: period.id, idempotencyKey: "p56-plan-race-1" });
    expect(replay.replayed).toBe(true);
  });

  it("bounds pagination and rejects SQL-shaped status input before it reaches a query", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const page = await production.listJobs(actor, { page: "1", limit: "1" });
    expect(page.page).toBe(1);
    expect(page.limit).toBe(1);
    expect(page.items.length).toBeLessThanOrEqual(1);
    await expect(production.listJobs(actor, { page: "0", limit: "1" })).rejects.toThrowError(ProductionDomainError);
    await expect(production.listJobs(actor, { page: "1", limit: "1", status: "draft' OR 1=1 --" })).rejects.toThrowError(ProductionDomainError);
  });

  it("keeps commercial and delivery decisions in their owner workflows", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const jobs = await production.listJobs(actor, { page: 1, limit: 10 });
    const job = jobs.items.find((candidate: any) => candidate.purchaseOrderId === "p56_service_po");
    const operational = await production.createChangeRequest(actor, job.id, {
      changeType: "operational",
      ownerDomain: "production",
      reason: "Move a production milestone",
      idempotencyKey: "p56-operational-change-1",
    });
    const admin = { userId: "p56_service_admin", role: "admin" as const };
    const needsInfo = await production.decideChangeRequest(admin, operational.change.id, { decision: "needs_information", notes: "Add the work-center reference", idempotencyKey: "p56-operational-decision-1" });
    expect(needsInfo.change.status).toBe("under_review");

    const commercial = await production.createChangeRequest(actor, job.id, {
      changeType: "commercial",
      ownerDomain: "orders",
      reason: "Request an owner-domain price review",
      idempotencyKey: "p56-commercial-change-1",
    });
    await expect(production.decideChangeRequest(admin, commercial.change.id, { decision: "approved", idempotencyKey: "p56-commercial-decision-bad" })).rejects.toMatchObject({ code: "OWNER_DECISION_REFERENCE_REQUIRED" });
    const approved = await production.decideChangeRequest(admin, commercial.change.id, { decision: "approved", decisionReference: "orders-change-123", idempotencyKey: "p56-commercial-decision-good" });
    expect(approved.change.status).toBe("approved");
    await expect(production.createChangeRequest(actor, job.id, {
      changeType: "delivery",
      ownerDomain: "production",
      reason: "Do not mutate shipping here",
      idempotencyKey: "p56-delivery-change-1",
    })).rejects.toMatchObject({ code: "SHIPPING_OWNER_REQUIRED" });
  });

  it("accepts only private artifact metadata and replays artifact registration", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const jobs = await production.listJobs(actor, { page: 1, limit: 10 });
    const job = jobs.items.find((candidate: any) => candidate.purchaseOrderId === "p56_service_po");
    await expect(production.registerArtifact(actor, job.id, { artifactType: "image", mimeType: "image/png", objectKey: "production/p56-service/evidence.png", byteSize: 10, checksumSha256: "a".repeat(64), contentBase64: "not accepted", idempotencyKey: "p56-artifact-bad" })).rejects.toMatchObject({ code: "ARTIFACT_BYTES_NOT_ACCEPTED" });
    const first = await production.registerArtifact(actor, job.id, { artifactType: "image", mimeType: "image/png", objectKey: "production/p56-service/evidence.png", byteSize: 10, checksumSha256: "a".repeat(64), idempotencyKey: "p56-artifact-good" });
    const replay = await production.registerArtifact(actor, job.id, { artifactType: "image", mimeType: "image/png", objectKey: "production/p56-service/evidence.png", byteSize: 10, checksumSha256: "a".repeat(64), idempotencyKey: "p56-artifact-good" });
    expect(first.artifact.id).toBe(replay.artifact.id);
    expect(replay.replayed).toBe(true);
    expect(first.artifact.private).toBe(true);
    expect(first.artifact.storageProvider).toBe("metadata_only");
  });
});
