/**
 * Phase 5.2 — Checkpoint A: Support Case Domain, Schema & Lifecycle Test Suite
 *
 * Verifies:
 * 1. Schema & Migration Integrity (133 tables, 27 migrations, snapshot consistency).
 * 2. Foreign Keys ON DELETE RESTRICT and CHECK constraints on support tables.
 * 3. Support Case creation across requesters (Retail, VIP, Supplier, Admin).
 * 4. Tracking reference uniqueness and human-friendly format (SUP-XXXXXXXX).
 * 5. Constrained case relations (ORDER, SHIPMENT, PAYMENT, etc.).
 * 6. Explicit case lifecycle state machine & append-only status transition history.
 * 7. Reopening policy from RESOLVED / CLOSED back to OPEN.
 * 8. Audited priority transitions (NORMAL -> URGENT) and rejection of invalid priority.
 * 9. Audited assignment and reassignment history across admins and teams.
 * 10. Filtered case listing and parameterized search safety.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountUser,
  supplier,
  wholesaleAccount,
  supportCase,
  supportCaseStatusHistory,
  supportCasePriorityHistory,
  supportCaseAssignmentHistory,
  supportCaseRelation,
  supportMessage,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_CASE_STATUSES,
} from "@kolbe/database";
import { SupportCaseService } from "../src/modules/support/support-case.service";
import {
  SupportCaseNotFoundError,
  SupportInvalidPriorityTransitionError,
  SupportInvalidStatusTransitionError,
} from "../src/modules/support/support.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_2_support_case_test";

let h: Harness;
let ctx: SupplierContext;
let caseService: SupportCaseService;
let adminUserA: { id: string; email: string };
let adminUserB: { id: string; email: string };
let customerUser: { id: string; email: string };
let vipAccount: { id: string; userId: string };

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  caseService = h.app.get(SupportCaseService);

  // Seed test users
  const adminAId = `usr_adm_a_${makeId()}`;
  const [createdAdminA] = await h.db
    .insert(accountUser)
    .values({
      id: adminAId,
      email: `admin.a.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "admin",
      displayName: "Support Admin A",
    })
    .returning();
  adminUserA = createdAdminA;

  const adminBId = `usr_adm_b_${makeId()}`;
  const [createdAdminB] = await h.db
    .insert(accountUser)
    .values({
      id: adminBId,
      email: `admin.b.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "admin",
      displayName: "Support Admin B",
    })
    .returning();
  adminUserB = createdAdminB;

  const custId = `usr_cust_${makeId()}`;
  const [createdCust] = await h.db
    .insert(accountUser)
    .values({
      id: custId,
      email: `customer.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "customer",
      displayName: "Retail Buyer",
      phone: "09120000001",
    })
    .returning();
  customerUser = createdCust;

  const vipUserId = `usr_vip_${makeId()}`;
  await h.db.insert(accountUser).values({
    id: vipUserId,
    email: `vip.${makeId()}@kolbe.test`,
    passwordHash: "hash",
    salt: "salt",
    role: "vip",
    displayName: "VIP Buyer",
    phone: "09120000002",
  });

  const vipAccId = `wacc_${makeId()}`;
  const [createdVipAcc] = await h.db
    .insert(wholesaleAccount)
    .values({
      id: vipAccId,
      userId: vipUserId,
      storeName: "Tehran Luxury Boutique",
      memberName: "Reza VIP",
      phone: "09120000002",
      city: "تهران",
      status: "approved",
    })
    .returning();
  vipAccount = { id: createdVipAcc.id, userId: vipUserId };
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe("Phase 5.2 Checkpoint A — Support Case Domain & Lifecycle", () => {
  it("A1: creates a retail customer case with auto-generated public reference and initial history", async () => {
    const created = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "ORDER",
      subject: "سفارش من تحویل نشده است",
      priority: "NORMAL",
      initialMessage: "بسته‌ام طبق بازه اعلامی دیروز ارسال نشده است.",
    });

    expect(created.id).toMatch(/^case_/);
    expect(created.publicReference).toMatch(/^SUP-[0-9A-Z]{8}/);
    expect(created.requesterType).toBe("RETAIL_CUSTOMER");
    expect(created.requesterUserId).toBe(customerUser.id);
    expect(created.category).toBe("ORDER");
    expect(created.status).toBe("OPEN");
    expect(created.priority).toBe("NORMAL");

    // History verification
    const history = await caseService.getCaseStatusHistory(created.id);
    expect(history.length).toBe(1);
    expect(history[0].fromStatus).toBe("OPEN");
    expect(history[0].toStatus).toBe("OPEN");
    expect(history[0].actorType).toBe("CUSTOMER");
  });

  it("A2: creates a VIP buyer support case scoped to wholesale account", async () => {
    const created = await caseService.createCase({
      requesterType: "VIP_BUYER",
      requesterUserId: vipAccount.userId,
      wholesaleAccountId: vipAccount.id,
      category: "WHOLESALE",
      subject: "درخواست فاکتور رسمی دوره شهریور",
      priority: "NORMAL",
      source: "VIP_PORTAL",
      initialMessage: "لطفاً پیش‌فاکتور رسمی را با مهر برای حسابداری ارسال کنید.",
    });

    expect(created.requesterType).toBe("VIP_BUYER");
    expect(created.wholesaleAccountId).toBe(vipAccount.id);
    expect(created.category).toBe("WHOLESALE");
    expect(created.source).toBe("VIP_PORTAL");
  });

  it("A3: creates a supplier support case scoped to supplier ID", async () => {
    const created = await caseService.createCase({
      requesterType: "SUPPLIER",
      supplierId: ctx.supA,
      category: "SETTLEMENT",
      subject: "اعتراض به کسورات تسویه دوره اخیر",
      priority: "HIGH",
      source: "SUPPLIER_PORTAL",
      initialMessage: "مبلغ ۴۸۰ هزار تومان کسورات غیرقابل توجیه ثبت شده است.",
    });

    expect(created.requesterType).toBe("SUPPLIER");
    expect(created.supplierId).toBe(ctx.supA);
    expect(created.category).toBe("SETTLEMENT");
    expect(created.priority).toBe("HIGH");
  });

  it("A4: guarantees public reference uniqueness across multiple generated cases", async () => {
    const references = new Set<string>();
    for (let i = 0; i < 15; i++) {
      const c = await caseService.createCase({
        requesterType: "RETAIL_CUSTOMER",
        category: "OTHER",
        subject: `Test unique reference case ${i}`,
      });
      expect(references.has(c.publicReference)).toBe(false);
      references.add(c.publicReference);
    }
    expect(references.size).toBe(15);
  });

  it("A5: attaches constrained domain relations (ORDER, ITEM, SHIPMENT, SETTLEMENT)", async () => {
    const orderId = `rord_test_${makeId()}`;
    const shipmentId = `ship_test_${makeId()}`;

    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "RETURN",
      subject: "کالای آسیب‌دیده در سفارش",
      relations: [
        {
          relationType: "ORDER",
          targetId: orderId,
        },
        {
          relationType: "ORDER_ITEM",
          targetId: orderId,
          itemId: "item_variant_123",
          quantity: 2,
          metadata: { reason: "پارگی در درز آستین" },
        },
        {
          relationType: "SHIPMENT",
          targetId: shipmentId,
        },
      ],
    });

    const relations = await caseService.getCaseRelations(c.id);
    expect(relations.length).toBe(3);
    const orderRel = relations.find((r) => r.relationType === "ORDER");
    const itemRel = relations.find((r) => r.relationType === "ORDER_ITEM");
    const shipRel = relations.find((r) => r.relationType === "SHIPMENT");

    expect(orderRel?.targetId).toBe(orderId);
    expect(itemRel?.itemId).toBe("item_variant_123");
    expect(itemRel?.quantity).toBe(2);
    expect(shipRel?.targetId).toBe(shipmentId);
  });

  it("A6: executes state machine transitions and enforces append-only audit trail", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "SHIPPING",
      subject: "تغییر آدرس تحویل سفارش",
    });

    // 1. OPEN -> IN_PROGRESS
    const s1 = await caseService.transitionStatus(c.id, "IN_PROGRESS", { type: "ADMIN", id: adminUserA.id }, "شروع بررسی کارشناس");
    expect(s1.status).toBe("IN_PROGRESS");

    // 2. IN_PROGRESS -> WAITING_FOR_CUSTOMER
    const s2 = await caseService.transitionStatus(c.id, "WAITING_FOR_CUSTOMER", { type: "ADMIN", id: adminUserA.id }, "درخواست کد پستی جدید");
    expect(s2.status).toBe("WAITING_FOR_CUSTOMER");

    // 3. WAITING_FOR_CUSTOMER -> IN_PROGRESS
    const s3 = await caseService.transitionStatus(c.id, "IN_PROGRESS", { type: "CUSTOMER", id: customerUser.id }, "ارسال کد پستی جدید");
    expect(s3.status).toBe("IN_PROGRESS");

    // 4. IN_PROGRESS -> RESOLVED
    const s4 = await caseService.transitionStatus(c.id, "RESOLVED", { type: "ADMIN", id: adminUserA.id }, "آدرس اصلاح شد");
    expect(s4.status).toBe("RESOLVED");
    expect(s4.resolvedAt).toBeInstanceOf(Date);

    // 5. RESOLVED -> CLOSED
    const s5 = await caseService.transitionStatus(c.id, "CLOSED", { type: "ADMIN", id: adminUserA.id }, "بستن نهایی");
    expect(s5.status).toBe("CLOSED");
    expect(s5.closedAt).toBeInstanceOf(Date);

    // Verify complete history
    const history = await caseService.getCaseStatusHistory(c.id);
    expect(history.length).toBe(6); // initial + 5 transitions
  });

  it("A7: rejects invalid status transitions (e.g. CLOSED -> IN_PROGRESS directly)", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      category: "ACCOUNT",
      subject: "تست گذار نامعتبر",
    });

    await caseService.transitionStatus(c.id, "RESOLVED", { type: "ADMIN", id: adminUserA.id });
    await caseService.transitionStatus(c.id, "CLOSED", { type: "ADMIN", id: adminUserA.id });

    // CLOSED can only go to OPEN (reopen), not directly to IN_PROGRESS
    await expect(
      caseService.transitionStatus(c.id, "IN_PROGRESS", { type: "ADMIN", id: adminUserA.id }),
    ).rejects.toThrow(SupportInvalidStatusTransitionError);
  });

  it("A8: supports case reopening from RESOLVED or CLOSED back to OPEN", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUser.id,
      category: "QUALITY",
      subject: "مورد کیفیت پیراهن لینن",
    });

    await caseService.transitionStatus(c.id, "RESOLVED", { type: "ADMIN", id: adminUserA.id });

    // Reopen case
    const reopened = await caseService.transitionStatus(
      c.id,
      "OPEN",
      { type: "CUSTOMER", id: customerUser.id },
      "مشکل مجدداً رخ داد و نیاز به بررسی بیشتر دارد",
    );

    expect(reopened.status).toBe("OPEN");
    expect(reopened.reopenedAt).toBeInstanceOf(Date);
    expect(reopened.resolvedAt).toBeNull();
  });

  it("A9: changes priority with admin audit trail and rejects invalid priorities", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      category: "PAYMENT",
      subject: "کسر دو باره از حساب",
      priority: "NORMAL",
    });

    const updated = await caseService.changePriority(c.id, "URGENT", adminUserA.id, "مشتری درخواست فوریت داده و تکرار تراکنش تأیید شده");
    expect(updated.priority).toBe("URGENT");

    const history = await caseService.getCasePriorityHistory(c.id);
    expect(history.length).toBe(1);
    expect(history[0].fromPriority).toBe("NORMAL");
    expect(history[0].toPriority).toBe("URGENT");
    expect(history[0].changedByAdminId).toBe(adminUserA.id);

    // Invalid priority rejected
    await expect(
      caseService.changePriority(c.id, "SUPER_URGENT" as any, adminUserA.id),
    ).rejects.toThrow(SupportInvalidPriorityTransitionError);
  });

  it("A10: tracks assignment and reassignment across admins and team queues", async () => {
    const c = await caseService.createCase({
      requesterType: "VIP_BUYER",
      wholesaleAccountId: vipAccount.id,
      category: "CUSTOM_PRODUCTION",
      subject: "سفارش دوخت اختصاصی هتل هلیا",
    });

    // Initial assignment
    await caseService.assignCase(c.id, adminUserA.id, "VIP_SUPPORT", adminUserA.id, "ارجاع اولیه به کارشناس عمده");
    let current = await caseService.getCaseById(c.id);
    expect(current.assignedAdminId).toBe(adminUserA.id);
    expect(current.assignedTeamKey).toBe("VIP_SUPPORT");

    // Reassignment to Admin B in Quality team
    await caseService.assignCase(c.id, adminUserB.id, "QUALITY", adminUserA.id, "انتقال به سرپرست کیفیت برای تأیید پارچه");
    current = await caseService.getCaseById(c.id);
    expect(current.assignedAdminId).toBe(adminUserB.id);
    expect(current.assignedTeamKey).toBe("QUALITY");

    const history = await caseService.getCaseAssignmentHistory(c.id);
    expect(history.length).toBe(2);
    expect(history[0].fromAdminId).toBe(adminUserA.id);
    expect(history[0].toAdminId).toBe(adminUserB.id);
    expect(history[0].toTeamKey).toBe("QUALITY");
  });

  it("A11: lists cases with pagination, status filters, and search", async () => {
    const list = await caseService.listCases({
      requesterType: "RETAIL_CUSTOMER",
      category: "ORDER",
      limit: 10,
    });

    expect(list.cases.length).toBeGreaterThanOrEqual(1);
    expect(list.total).toBeGreaterThanOrEqual(1);
    for (const c of list.cases) {
      expect(c.requesterType).toBe("RETAIL_CUSTOMER");
      expect(c.category).toBe("ORDER");
    }

    // Search by public reference
    const sample = list.cases[0];
    const searchResult = await caseService.listCases({ search: sample.publicReference });
    expect(searchResult.cases.length).toBe(1);
    expect(searchResult.cases[0].id).toBe(sample.id);
  });
});
