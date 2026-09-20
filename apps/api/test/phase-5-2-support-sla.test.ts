/**
 * Phase 5.2 — Checkpoint C: Assignment, SLA, Escalation & Operations Test Suite
 *
 * Verifies:
 * 1. Versioned SLA policies and hierarchical matching algorithm.
 * 2. Immutable SLA target snapshotting per case (policy changes never rewrite history).
 * 3. SLA clock evaluation, first response tracking, resolution tracking, breach detection.
 * 4. Multi-level escalation engine (priority bumping, team routing, immutable escalation history).
 * 5. Operational queues (unassigned, personal, team, urgent, breached).
 * 6. Support Control Tower factual metrics aggregation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountUser,
  supportCase,
  supportCaseSla,
  supportSlaPolicy,
  supportCaseEscalationHistory,
} from "@kolbe/database";
import { SupportCaseService } from "../src/modules/support/support-case.service";
import { SupportSlaService } from "../src/modules/support/support-sla.service";
import { SupportOperationsService } from "../src/modules/support/support-operations.service";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_2_support_sla_test";

let h: Harness;
let ctx: SupplierContext;
let caseService: SupportCaseService;
let slaService: SupportSlaService;
let opsService: SupportOperationsService;

let adminUserA: { id: string; email: string };
let adminUserB: { id: string; email: string };
let customerUser: { id: string; email: string };

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  caseService = h.app.get(SupportCaseService);
  slaService = h.app.get(SupportSlaService);
  opsService = h.app.get(SupportOperationsService);

  // Seed Admin A
  const adminAId = `usr_adm_${makeId()}`;
  const [createdAdminA] = await h.db
    .insert(accountUser)
    .values({
      id: adminAId,
      email: `admin.a.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "admin",
      displayName: "Triage Lead A",
    })
    .returning();
  adminUserA = createdAdminA;

  // Seed Admin B
  const adminBId = `usr_adm_${makeId()}`;
  const [createdAdminB] = await h.db
    .insert(accountUser)
    .values({
      id: adminBId,
      email: `admin.b.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "admin",
      displayName: "Quality Lead B",
    })
    .returning();
  adminUserB = createdAdminB;

  // Seed Customer
  const custId = `usr_cust_${makeId()}`;
  const [createdCust] = await h.db
    .insert(accountUser)
    .values({
      id: custId,
      email: `customer.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "customer",
      displayName: "Customer Kaveh",
    })
    .returning();
  customerUser = createdCust;
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe("Phase 5.2 Checkpoint C — Support SLA, Escalation & Operations", () => {
  it("C1: creates versioned SLA policies and executes hierarchical matching", async () => {
    // 1. Generic Normal Priority Policy
    const genericPolicy = await slaService.createPolicy({
      policyCode: "GENERIC_NORMAL",
      name: "عمومی اولویت عادی",
      priority: "NORMAL",
      firstResponseTargetMinutes: 240, // 4 hours
      resolutionTargetMinutes: 1440, // 24 hours
    });
    expect(genericPolicy.version).toBe(1);

    // 2. Specific VIP Wholesale Policy
    const vipPolicy = await slaService.createPolicy({
      policyCode: "VIP_WHOLESALE_URGENT",
      name: "عمده فوری VIP",
      requesterType: "VIP_BUYER",
      category: "WHOLESALE",
      priority: "URGENT",
      firstResponseTargetMinutes: 30, // 30 mins
      resolutionTargetMinutes: 240, // 4 hours
    });

    // Match VIP urgent wholesale
    const matchedVip = await slaService.matchPolicy("VIP_BUYER", "WHOLESALE", "URGENT");
    expect(matchedVip?.id).toBe(vipPolicy.id);
    expect(matchedVip?.firstResponseTargetMinutes).toBe(30);

    // Match generic retail normal
    const matchedRetail = await slaService.matchPolicy("RETAIL_CUSTOMER", "ORDER", "NORMAL");
    expect(matchedRetail?.id).toBe(genericPolicy.id);
    expect(matchedRetail?.firstResponseTargetMinutes).toBe(240);
  });

  it("C2: snapshots SLA targets immutably per case", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "SHIPPING",
      priority: "NORMAL",
      subject: "بررسی اسنپ‌شات SLA",
    });

    const slaSnapshot = await slaService.applySlaToCase(c.id);
    expect(slaSnapshot.caseId).toBe(c.id);
    expect(slaSnapshot.firstResponseTargetMinutes).toBe(240);
    expect(slaSnapshot.resolutionTargetMinutes).toBe(1440);

    // Create a new version of the policy with shorter targets
    await slaService.createPolicy({
      policyCode: "GENERIC_NORMAL",
      name: "عمومی اولویت عادی ویرایش ۲",
      priority: "NORMAL",
      firstResponseTargetMinutes: 60,
      resolutionTargetMinutes: 360,
    });

    // Existing case SLA must remain completely unchanged (immutable snapshot)
    const slaSecondCheck = await slaService.applySlaToCase(c.id);
    expect(slaSecondCheck.id).toBe(slaSnapshot.id);
    expect(slaSecondCheck.firstResponseTargetMinutes).toBe(240);
    expect(slaSecondCheck.resolutionTargetMinutes).toBe(1440);
  });

  it("C3: calculates SLA clocks, records response/resolution, and derives breach status", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "QUALITY",
      priority: "NORMAL",
      subject: "محاسبه زمان‌های SLA",
    });

    await slaService.applySlaToCase(c.id);

    // Initial evaluation: not breached, no first response yet
    let evalRes = await slaService.evaluateCaseSla(c.id);
    expect(evalRes.firstResponseAt).toBeNull();
    expect(evalRes.isFirstResponseBreached).toBe(false);

    // Record response within target
    const responseTime = new Date(c.openedAt.getTime() + 30 * 60 * 1000); // 30 mins later
    await slaService.recordFirstResponse(c.id, responseTime);

    evalRes = await slaService.evaluateCaseSla(c.id);
    expect(evalRes.firstResponseAt).toBeInstanceOf(Date);
    expect(evalRes.isFirstResponseBreached).toBe(false);

    // Record resolution
    const resolutionTime = new Date(c.openedAt.getTime() + 120 * 60 * 1000); // 2 hours later
    await slaService.recordResolution(c.id, resolutionTime);

    evalRes = await slaService.evaluateCaseSla(c.id);
    expect(evalRes.resolvedAt).toBeInstanceOf(Date);
    expect(evalRes.isResolutionBreached).toBe(false);
  });

  it("C4: escalates case priority and team routing with immutable audit history", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "RETURN",
      priority: "NORMAL",
      subject: "مورد نیاز به ارتقا",
    });

    // Escalate from NORMAL -> URGENT, routing to QUALITY team
    const result = await slaService.escalateCase(c.id, {
      reason: "مشتری VIP سابق و عدم پاسخگویی تأمین‌کننده در ۲۴ ساعت",
      source: "MANUAL_ADMIN",
      newPriority: "URGENT",
      toTeamKey: "QUALITY",
      actorAdminId: adminUserA.id,
    });

    expect(result.case.priority).toBe("URGENT");
    expect(result.case.assignedTeamKey).toBe("QUALITY");
    expect(result.escalation.fromPriority).toBe("NORMAL");
    expect(result.escalation.toPriority).toBe("URGENT");
    expect(result.escalation.fromTeamKey).toBeNull();
    expect(result.escalation.toTeamKey).toBe("QUALITY");

    // Verify history records
    const escalations = await slaService.getCaseEscalations(c.id);
    expect(escalations.length).toBe(1);
    expect(escalations[0].reason).toContain("عدم پاسخگویی تأمین‌کننده");
  });

  it("C5: queries operational queues (unassigned, my queue, team queue, urgent)", async () => {
    // 1. Create an unassigned case
    const c1 = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      category: "OTHER",
      priority: "LOW",
      subject: "تست صف بدون تخصیص",
    });

    const unassigned = await opsService.getUnassignedQueue();
    expect(unassigned.cases.some((item) => item.id === c1.id)).toBe(true);

    // 2. Assign case to Admin A in RETAIL_SUPPORT team
    await caseService.assignCase(c1.id, adminUserA.id, "RETAIL_SUPPORT", adminUserA.id, "تخصیص تست");

    // Case is now in Admin A's queue
    const myQueue = await opsService.getMyQueue(adminUserA.id);
    expect(myQueue.cases.some((item) => item.id === c1.id)).toBe(true);

    // Case is in RETAIL_SUPPORT team queue
    const teamQueue = await opsService.getTeamQueue("RETAIL_SUPPORT");
    expect(teamQueue.cases.some((item) => item.id === c1.id)).toBe(true);

    // 3. Create an urgent case
    const cUrgent = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      category: "PAYMENT",
      priority: "URGENT",
      subject: "تست صف فوری",
    });

    const urgentQueue = await opsService.getUrgentQueue();
    expect(urgentQueue.cases.some((item) => item.id === cUrgent.id)).toBe(true);
  });

  it("C6: calculates Support Control Tower factual metrics without anomalies", async () => {
    const metrics = await opsService.getControlTowerMetrics();

    expect(metrics.overview.totalCases).toBeGreaterThan(0);
    expect(metrics.overview.activeCases).toBeGreaterThan(0);
    expect(metrics.byStatus.OPEN).toBeGreaterThanOrEqual(1);
    expect(metrics.byPriority.NORMAL).toBeGreaterThanOrEqual(1);
    expect(metrics.slaPerformance.totalWithSla).toBeGreaterThanOrEqual(1);
    expect(metrics.slaPerformance.complianceRate).toBeGreaterThanOrEqual(0);
    expect(metrics.slaPerformance.complianceRate).toBeLessThanOrEqual(100);
    expect(Number.isNaN(metrics.slaPerformance.complianceRate)).toBe(false);
  });
});
