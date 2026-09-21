import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProductionService } from "../src/modules/production/production.service";
import { ProductionNotificationRelayService } from "../src/modules/production/production-notification-relay.service";
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-query.service";
import { assertArtifactMetadata, assertRecallTarget, pageInput, ProductionDomainError } from "../src/modules/production/production.logic";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_6_security_test";
const supplierId = "p56_security_supplier";
const sellerId = "p56_security_seller";
const ownerId = "p56_security_owner";
const outsiderId = "p56_security_outsider";
const adminId = "p56_security_admin";
const poId = "p56_security_po";
const jobId = "p56_security_job";
const lotId = "p56_security_lot";

let pool: Pool;
let production: ProductionService;
let notificationRelay: ProductionNotificationRelayService;
let analytics: AnalyticsQueryService;
const notificationCalls: any[] = [];

const orders = {
  async getProductionEligibility({ childOrderId }: { childOrderId: string }) {
    return { child: { id: childOrderId, supplierId, sellerId, status: "confirmed", version: 0 }, targetUnits: 2, items: [] };
  },
  async isProductionTargetInSupplierScope() {
    return false;
  },
};
const suppliers = {
  async getUserMemberships(userId: string) {
    return userId === ownerId ? [{ supplierId, sellerId, role: "owner" }] : [];
  },
  async listMembers() {
    return [{ id: "p56_security_member", supplierId, userId: ownerId, role: "owner" }];
  },
};
const audit = { record: async () => "p56-security-audit" };
const dispatcher = {
  async dispatchDomainEvent(input: any) {
    notificationCalls.push(input);
    throw new Error("notification provider unavailable");
  },
};
const approvals = {
  async decideApprovalRequest() { return { status: "approved" }; },
};

async function seed() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ($1, $2, 'hash', 'salt', 'supplier', 'active'),
           ($3, $4, 'hash', 'salt', 'supplier', 'active'),
           ($5, $6, 'hash', 'salt', 'admin', 'active')
  `, [ownerId, `${ownerId}@test.invalid`, outsiderId, `${outsiderId}@test.invalid`, adminId, `${adminId}@test.invalid`]);
  await pool.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ($1, 'P56 Security Supplier', 'P56 Security Supplier', 'approved')`, [supplierId]);
  await pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'SUPPLIER', $2, 'P56 Security Seller', 'active')`, [sellerId, supplierId]);
  await pool.query(`INSERT INTO supplier_member (id, supplier_id, user_id, role) VALUES ('p56_security_member', $1, $2, 'owner')`, [supplierId, ownerId]);
  await pool.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, status, currency) VALUES ($1, 'P56-SECURITY-PO', $2, $3, 'confirmed', 'IRR')`, [poId, sellerId, supplierId]);
  await pool.query(`INSERT INTO production_job (id, purchase_order_id, supplier_id, seller_id, purchase_order_version, status, target_units, created_by) VALUES ($1, $2, $3, $4, 0, 'completed', 2, $5)`, [jobId, poId, supplierId, sellerId, ownerId]);
  await pool.query(`INSERT INTO production_lot (id, job_id, purchase_order_id, lot_code, status, planned_units, produced_units, accepted_units, created_by) VALUES ($1, $2, $3, 'P56-SECURITY-LOT', 'completed', 2, 2, 2, $4)`, [lotId, jobId, poId, ownerId]);
}

describe("Phase 5.6 production security, recall boundaries, and IDOR resistance", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    await seed();
    production = new ProductionService(drizzle(pool) as any, orders as any, suppliers as any, audit as any, approvals as any);
    notificationRelay = new ProductionNotificationRelayService(drizzle(pool) as any, suppliers as any, dispatcher as any);
    analytics = new AnalyticsQueryService(drizzle(pool) as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("rejects IDOR, arbitrary pagination/status injection, and unsafe artifacts", async () => {
    await expect(production.getJob({ userId: outsiderId, role: "supplier" }, jobId)).rejects.toMatchObject({ code: "SUPPLIER_OWNERSHIP_VIOLATION" });
    expect(() => pageInput("1; DROP TABLE production_job", "25")).toThrowError(ProductionDomainError);
    expect(() => assertArtifactMetadata({ artifactType: "other", mimeType: "application/x-executable", objectKey: "production/p56/file", byteSize: 1, checksumSha256: "a".repeat(64) })).toThrowError(ProductionDomainError);
    expect(() => assertRecallTarget({ scopeType: "lot", lotId: lotId, variantId: "attacker-variant" })).toThrowError(/exactly one/);
    expect(() => assertRecallTarget({ scopeType: "order_item", lotId: lotId })).toThrowError(/requires its matching target/);
  });

  it("allows a supplier to propose an exact lot recall but never approve it", async () => {
    const supplier = { userId: ownerId, role: "supplier" as const };
    const created = await production.createRecall(supplier, {
      jobId,
      severity: "critical",
      scopeType: "lot",
      reason: "Suspected seam failure",
      scopes: [{ lotId, quantity: 2 }],
      idempotencyKey: "p56-security-recall-create",
    });
    expect(created.recall.status).toBe("draft");
    await expect(production.approveRecall(supplier, created.recall.id, { decision: "approve", idempotencyKey: "p56-security-recall-supplier-approve" })).rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    await expect(pool.query("INSERT INTO production_recall_scope (id, recall_id, lot_id, variant_id) VALUES ('p56-security-bad-scope', $1, $2, 'p56-variant')", [created.recall.id, lotId])).rejects.toThrow();
  });

  it("exposes only source-backed production facts to the read-only Analytics dictionary", async () => {
    const report = await analytics.run({
      metricKeys: ["production.jobs_count", "production.actual_units", "production.recalls_count"],
      scope: "SUPPLIER",
      scopeId: supplierId,
      range: { preset: "CUSTOM", startUtc: "2020-01-01T00:00:00.000Z", endUtc: "2030-01-01T00:00:00.000Z", timezone: "UTC" },
    });
    expect(report.metrics.map((metric) => metric.key)).toEqual(["production.jobs_count", "production.actual_units", "production.recalls_count"]);
    expect(report.metrics[0].value).toBe("1");
    expect(report.metrics[1].value).toBe("0");
    expect(report.metrics[2].value).toBe("1");
  });

  it("relays factual production events through Notifications without making delivery authoritative", async () => {
    await pool.query(`INSERT INTO production_event (id, event_type, source_entity_type, source_entity_id, job_id, supplier_id, payload) VALUES ('p56-security-event', 'RECALL_SUBMITTED', 'production_recall', 'p56-security-recall-fact', $1, $2, '{"severity":"critical"}'::jsonb)`, [jobId, supplierId]);
    const result = await notificationRelay.relayEvent("p56-security-event");
    expect(result).toEqual({ deliveries: 0, failures: 1 });
    expect(notificationCalls[0]).toMatchObject({
      eventKey: "SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED",
      sourceDomain: "production",
      recipientType: "SUPPLIER_MEMBER",
      recipientId: "p56_security_member",
      category: "OPERATIONAL",
    });
    const job = await pool.query("SELECT status FROM production_job WHERE id = $1", [jobId]);
    expect(job.rows[0].status).toBe("completed");
  });

  it("requires a distinct Admin checker for activation and preserves approval rows", async () => {
    const approvalId = "p56_security_approval";
    const recallId = "p56_security_recall";
    await pool.query(`INSERT INTO approval_request (id, request_type, target_type, target_id, maker_id, status, payload, idempotency_key) VALUES ($1, 'PRODUCTION_RECALL', 'production_recall', $2, $3, 'pending', '{}'::jsonb, 'p56-security-approval-key')`, [approvalId, recallId, ownerId]);
    await pool.query(`INSERT INTO production_recall (id, supplier_id, job_id, severity, scope_type, status, reason, approval_request_id, maker_id) VALUES ($1, $2, $3, 'critical', 'lot', 'pending_approval', 'Security recall', $4, $5)`, [recallId, supplierId, jobId, approvalId, ownerId]);
    await pool.query(`INSERT INTO production_recall_scope (id, recall_id, lot_id, quantity) VALUES ('p56-security-scope', $1, $2, 2)`, [recallId, lotId]);
    const approved = await production.approveRecall({ userId: adminId, role: "admin" }, recallId, { decision: "approve", idempotencyKey: "p56-security-recall-admin-approve" });
    expect(approved.recall.status).toBe("active");
    expect(approved.recall.checkerId).toBe(adminId);
    const approval = await pool.query("SELECT maker_id, checker_id, decision FROM production_recall_approval WHERE recall_id = $1", [recallId]);
    expect(approval.rows[0]).toMatchObject({ maker_id: ownerId, checker_id: adminId, decision: "approved" });
    await expect(pool.query("UPDATE production_recall_approval SET notes = 'tampered' WHERE recall_id = $1", [recallId])).rejects.toThrow(/phase_5_6_immutable_row/);
  });
});
