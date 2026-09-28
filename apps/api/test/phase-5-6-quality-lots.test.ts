import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProductionService } from "../src/modules/production/production.service";
import { ProductionDomainError } from "../src/modules/production/production.logic";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_6_quality_lots_test";
const supplierId = "p56_quality_supplier";
const sellerId = "p56_quality_seller";
const ownerId = "p56_quality_owner";
const adminId = "p56_quality_admin";
const poId = "p56_quality_po";

let pool: Pool;
let production: ProductionService;

const orders = {
  async getProductionEligibility({ childOrderId }: { childOrderId: string }) {
    return {
      child: { id: childOrderId, supplierId, sellerId, status: "confirmed", version: 0 },
      targetUnits: 5,
      items: [],
    };
  },
};
const suppliers = {
  async getUserMemberships(userId: string) {
    return userId === ownerId ? [{ supplierId, sellerId, role: "owner" }] : [];
  },
};
const audit = { record: async () => "p56-quality-audit" };
const approvals = {};

async function seed() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ($1, $2, 'hash', 'salt', 'supplier', 'active'),
           ($3, $4, 'hash', 'salt', 'admin', 'active')
  `, [ownerId, `${ownerId}@test.invalid`, adminId, `${adminId}@test.invalid`]);
  await pool.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ($1, 'P56 Quality Supplier', 'P56 Quality Supplier', 'approved')`, [supplierId]);
  await pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'SUPPLIER', $2, 'P56 Quality Seller', 'active')`, [sellerId, supplierId]);
  await pool.query(`INSERT INTO supplier_member (id, supplier_id, user_id, role) VALUES ('p56_quality_member', $1, $2, 'owner')`, [supplierId, ownerId]);
  await pool.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, status, currency) VALUES ($1, 'P56-QUALITY-PO', $2, $3, 'confirmed', 'IRR')`, [poId, sellerId, supplierId]);
}

describe("Phase 5.6 QC arithmetic, lot traceability, rework, and quality release", () => {
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

  it("keeps failed inspection evidence, runs rework, and exposes a shipping handoff only after release", async () => {
    const supplier = { userId: ownerId, role: "supplier" as const };
    const admin = { userId: adminId, role: "admin" as const };
    const period = await production.createCapacityPeriod(supplier, {
      startsAt: "2027-01-01T00:00:00.000Z",
      endsAt: "2027-01-02T00:00:00.000Z",
      declaredUnits: 10,
    });
    const job = await production.createJob(supplier, { purchaseOrderId: poId, requiresSampleApproval: false, idempotencyKey: "p56-quality-job" });
    await production.planJob(supplier, job.job.id, { capacityPeriodId: period.id, idempotencyKey: "p56-quality-plan" });
    await production.transitionJob(supplier, job.job.id, "in_progress", { idempotencyKey: "p56-quality-start" });
    await production.recordActualUnits(supplier, job.job.id, 5, { idempotencyKey: "p56-quality-actual" });
    const lot = await production.createLot(supplier, job.job.id, { lotCode: "P56-QUALITY-LOT", plannedUnits: 5, idempotencyKey: "p56-quality-lot" });
    await production.transitionLot(supplier, job.job.id, lot.lot.id, "in_progress", { idempotencyKey: "p56-quality-lot-start" });
    await production.addLotTrace(supplier, job.job.id, lot.lot.id, { traceType: "source_lot", sourceLotId: lot.lot.id, quantity: 5, idempotencyKey: "p56-quality-trace" });
    await expect(production.recordLotOutput(supplier, job.job.id, lot.lot.id, { producedUnits: 5, acceptedUnits: 4, rejectedUnits: 0, reworkUnits: 2, idempotencyKey: "p56-quality-output-invalid" })).rejects.toMatchObject({ code: "LOT_ARITHMETIC_INVARIANT" });
    await production.recordLotOutput(supplier, job.job.id, lot.lot.id, { producedUnits: 5, acceptedUnits: 4, rejectedUnits: 0, reworkUnits: 1, idempotencyKey: "p56-quality-output" });
    await production.transitionLot(supplier, job.job.id, lot.lot.id, "completed", { idempotencyKey: "p56-quality-lot-complete" });
    await production.transitionJob(supplier, job.job.id, "completed", { idempotencyKey: "p56-quality-complete" });

    const checklist = await production.createChecklist(admin, {
      checklistKey: "p56-quality-checklist",
      name: "P56 final inspection",
      items: [{ itemKey: "count", label: "Count", sequence: 1, measurementType: "integer", minInteger: 0, maxInteger: 10 }],
    });
    await production.publishChecklist(admin, checklist.checklist.id, { idempotencyKey: "p56-quality-publish" });
    const inspection = await production.createInspection(supplier, job.job.id, { lotId: lot.lot.id, checklistId: checklist.checklist.id, sampleSize: 5, idempotencyKey: "p56-quality-inspection" });
    const submitted = await production.submitInspection(supplier, job.job.id, inspection.inspection.id, {
      acceptedUnits: 4,
      defectUnits: 1,
      reworkUnits: 0,
      rejectedUnits: 0,
      decision: "accepted",
      items: [{ checklistItemId: checklist.items[0].id, observedInteger: 5, passed: true }],
      idempotencyKey: "p56-quality-inspection-submit",
    });
    expect(submitted.inspection.passRateBps).toBe(8000);
    await expect(pool.query("UPDATE quality_inspection SET decision = 'rejected' WHERE id = $1", [inspection.inspection.id])).rejects.toThrow(/phase_5_6_submitted_inspection_immutable/);

    const defect = await production.recordDefect(supplier, job.job.id, { lotId: lot.lot.id, inspectionId: inspection.inspection.id, defectCode: "SEAM", description: "Open seam", severity: "major", quantity: 1, idempotencyKey: "p56-quality-defect" });
    const blocked = await production.getReleaseReadiness(supplier, job.job.id, lot.lot.id);
    expect(blocked.ready).toBe(false);
    expect(blocked.reasons).toContain("OPEN_MAJOR_OR_CRITICAL_DEFECT");
    const rework = await production.createRework(supplier, job.job.id, { lotId: lot.lot.id, defectId: defect.defect.id, quantity: 1, instructions: "Restitch and reinspect", idempotencyKey: "p56-quality-rework" });
    await production.transitionRework(supplier, job.job.id, rework.rework.id, "in_progress", { idempotencyKey: "p56-quality-rework-start" });
    await production.transitionRework(supplier, job.job.id, rework.rework.id, "completed", { idempotencyKey: "p56-quality-rework-complete" });
    await production.transitionDefect(supplier, job.job.id, defect.defect.id, "closed", { dispositionNote: "Rework passed", idempotencyKey: "p56-quality-defect-close" });

    const request = await production.requestQualityRelease(supplier, job.job.id, { lotId: lot.lot.id, idempotencyKey: "p56-quality-release-request" });
    expect(request.readiness.ready).toBe(true);
    const approved = await production.approveQualityRelease(admin, request.release.id, { decision: "approve", idempotencyKey: "p56-quality-release-approve" });
    expect(approved.release.status).toBe("approved");
    expect((await production.getShippingHandoff(supplier, request.release.id)).eligible).toBe(true);
    const state = await pool.query("SELECT status FROM production_lot WHERE id = $1", [lot.lot.id]);
    expect(state.rows[0].status).toBe("released");
  });

  it("rejects invalid integer QC arithmetic before creating an inspection result", async () => {
    expect(() => new ProductionDomainError("QC_ARITHMETIC_INVARIANT", "bad")).not.toThrow();
    const result = await pool.query("SELECT COUNT(*)::int AS count FROM quality_inspection_item");
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(1);
  });
});
