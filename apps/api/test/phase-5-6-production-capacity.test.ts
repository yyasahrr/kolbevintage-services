import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProductionService } from "../src/modules/production/production.service";
import { ProductionDomainError } from "../src/modules/production/production.logic";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_6_capacity_test";
const supplierId = "p56_capacity_supplier";
const sellerId = "p56_capacity_seller";
const ownerId = "p56_capacity_owner";
const outsiderId = "p56_capacity_outsider";

let pool: Pool;
let production: ProductionService;

const orderContexts: Record<string, number> = {
  p56_capacity_po_1: 6,
  p56_capacity_po_2: 6,
};

const orders = {
  async getProductionEligibility({ childOrderId }: { childOrderId: string }) {
    const targetUnits = orderContexts[childOrderId];
    if (!targetUnits) throw new Error(`unexpected child order ${childOrderId}`);
    return {
      child: { id: childOrderId, supplierId, sellerId, status: "confirmed", version: 0 },
      targetUnits,
      items: [],
    };
  },
};
const suppliers = {
  async getUserMemberships(userId: string) {
    return userId === ownerId ? [{ supplierId, sellerId, role: "owner" }] : [];
  },
};
const audit = { record: async () => "p56-capacity-audit" };
const approvals = {};

async function seed() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ($1, $2, 'hash', 'salt', 'supplier', 'active'),
           ($3, $4, 'hash', 'salt', 'supplier', 'active')
  `, [ownerId, `${ownerId}@test.invalid`, outsiderId, `${outsiderId}@test.invalid`]);
  await pool.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ($1, 'P56 Capacity Supplier', 'P56 Capacity Supplier', 'approved')`, [supplierId]);
  await pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'SUPPLIER', $2, 'P56 Capacity Seller', 'active')`, [sellerId, supplierId]);
  await pool.query(`INSERT INTO supplier_member (id, supplier_id, user_id, role) VALUES ('p56_capacity_member', $1, $2, 'owner')`, [supplierId, ownerId]);
  await pool.query(`
    INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, status, currency)
    VALUES ('p56_capacity_po_1', 'P56-CAP-1', $1, $2, 'confirmed', 'IRR'),
           ('p56_capacity_po_2', 'P56-CAP-2', $1, $2, 'confirmed', 'IRR')
  `, [sellerId, supplierId]);
}

describe("Phase 5.6 capacity authority and PostgreSQL reservation races", () => {
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

  it("derives supplier identity from membership instead of trusting supplierId input", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const period = await production.createCapacityPeriod(actor, {
      supplierId: "attacker-selected-supplier",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-02T00:00:00.000Z",
      declaredUnits: 10,
    });
    expect(period.supplierId).toBe(supplierId);
    await expect(production.createCapacityPeriod({ userId: outsiderId, role: "supplier" }, {
      supplierId,
      startsAt: "2026-10-03T00:00:00.000Z",
      endsAt: "2026-10-04T00:00:00.000Z",
      declaredUnits: 10,
    })).rejects.toMatchObject({ code: "SUPPLIER_CONTEXT_AMBIGUOUS" });
  });

  it("serializes competing reservations and releases a planned reservation on cancellation", async () => {
    const actor = { userId: ownerId, role: "supplier" as const };
    const period = await production.createCapacityPeriod(actor, {
      startsAt: "2026-11-01T00:00:00.000Z",
      endsAt: "2026-11-02T00:00:00.000Z",
      declaredUnits: 10,
    });
    const first = await production.createJob(actor, { purchaseOrderId: "p56_capacity_po_1", idempotencyKey: "capacity-job-one" });
    const second = await production.createJob(actor, { purchaseOrderId: "p56_capacity_po_2", idempotencyKey: "capacity-job-two" });

    const attempts = await Promise.allSettled([
      production.planJob(actor, first.job.id, { capacityPeriodId: period.id, idempotencyKey: "capacity-plan-one" }),
      production.planJob(actor, second.job.id, { capacityPeriodId: period.id, idempotencyKey: "capacity-plan-two" }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const failed = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "CAPACITY_INSUFFICIENT" });

    const planned = attempts.find((attempt) => attempt.status === "fulfilled") as PromiseFulfilledResult<any>;
    const cancelled = await production.transitionJob(actor, planned.value.job.id, "cancelled", {
      idempotencyKey: "capacity-cancel-planned",
      reason: "supplier shutdown",
    });
    expect(cancelled.job.status).toBe("cancelled");
    const row = await pool.query("SELECT reserved_units FROM supplier_capacity_period WHERE id = $1", [period.id]);
    // available_units is a response projection, not a stored authority; the database row has only the counters.
    expect(Number(row.rows[0].reserved_units)).toBe(0);
    await expect(production.transitionJob(actor, planned.value.job.id, "in_progress", { idempotencyKey: "capacity-illegal-start" })).rejects.toThrowError(ProductionDomainError);
  });

  it("keeps declared, reserved, unavailable, and actual quantities distinct at the database boundary", async () => {
    const period = await production.createCapacityPeriod({ userId: ownerId, role: "supplier" }, {
      startsAt: "2026-12-01T00:00:00.000Z",
      endsAt: "2026-12-02T00:00:00.000Z",
      declaredUnits: 20,
    });
    const closure = await production.createClosure({ userId: ownerId, role: "supplier" }, {
      capacityPeriodId: period.id,
      startsAt: "2026-12-01T04:00:00.000Z",
      endsAt: "2026-12-01T08:00:00.000Z",
      unavailableUnits: 5,
      reason: "maintenance",
    });
    expect(closure.unavailableUnits).toBe(5);
    const row = await pool.query("SELECT declared_units, reserved_units, unavailable_units, actual_units FROM supplier_capacity_period WHERE id = $1", [period.id]);
    expect(row.rows[0]).toMatchObject({ declared_units: 20, reserved_units: 0, unavailable_units: 5, actual_units: 0 });
  });
});
