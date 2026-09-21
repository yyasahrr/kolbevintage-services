/**
 * Phase 5.2 — Checkpoint D: Multi-Portal Support APIs & Case Operations Test Suite
 *
 * Verifies:
 * 1. Retail Customer Portal API (/api/v1/support/cases)
 * 2. VIP Wholesale Support Portal API (/api/v1/vip/support/cases)
 * 3. Supplier Support Portal API (/api/v1/supplier/support/cases)
 * 4. Admin Support Operations API (/api/v1/admin/support)
 * 5. Cross-domain resolution actions (support_case_action)
 * 6. Legacy cutover adapters (wholesale tickets & supplier disputes)
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountUser,
  adminRole,
  adminRolePermission,
  adminUserRole,
  supplierMember,
  wholesaleAccount,
} from "@kolbe/database";
import { SupportCaseService } from "../src/modules/support/support-case.service";
import { LegacyCutoverAdapter } from "../src/modules/support/legacy-cutover.adapter";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_2_support_portals_test";

let h: Harness;
let ctx: SupplierContext;
let caseService: SupportCaseService;

let adminUserId: string;
let customerAId: string;
let customerBId: string;
let vipUserId: string;
let vipAccountId: string;
let supplierUserId: string;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  caseService = h.app.get(SupportCaseService);

  // 1. Admin
  adminUserId = makeId("adm_sup");
  await h.db.insert(accountUser).values({
    id: adminUserId,
    email: "admin_support@kolbe.test",
    displayName: "Admin Support Lead",
    passwordHash: "h",
    salt: "s",
    role: "admin",
    status: "active",
  });

  // Assign full support permissions to admin
  const supportRoleId = makeId("role_sup");
  await h.db.insert(adminRole).values({
    id: supportRoleId,
    name: "support_lead_role",
    displayName: "نقش سرپرست پشتیبانی",
  });

  const supportActions = [
    "support:case:view",
    "support:case:reply",
    "support:case:assign",
    "support:case:priority",
    "support:case:resolve",
    "support:internal_note:create",
    "support:attachment:view",
    "support:sla:manage",
    "support:report:view",
    "support:sensitive:view",
  ];

  await h.db.insert(adminRolePermission).values(
    supportActions.map((action) => ({
      id: makeId("arp"),
      roleId: supportRoleId,
      action,
      assignedBy: ctx.userAdmin,
    })),
  );

  await h.db.insert(adminUserRole).values({
    id: makeId("aur"),
    userId: adminUserId,
    roleId: supportRoleId,
    assignedBy: ctx.userAdmin,
  });

  // 2. Retail Customer A
  customerAId = makeId("usr_cust_a");
  await h.db.insert(accountUser).values({
    id: customerAId,
    email: "customer_a@kolbe.test",
    displayName: "Ali Buyer",
    passwordHash: "h",
    salt: "s",
    role: "customer",
    status: "active",
    phone: "09121111111",
  });

  // 3. Retail Customer B
  customerBId = makeId("usr_cust_b");
  await h.db.insert(accountUser).values({
    id: customerBId,
    email: "customer_b@kolbe.test",
    displayName: "Sara Buyer",
    passwordHash: "h",
    salt: "s",
    role: "customer",
    status: "active",
    phone: "09122222222",
  });

  // 4. VIP Buyer
  vipUserId = makeId("usr_vip");
  await h.db.insert(accountUser).values({
    id: vipUserId,
    email: "vip_buyer@kolbe.test",
    displayName: "Hossein VIP",
    passwordHash: "h",
    salt: "s",
    role: "vip",
    status: "active",
    phone: "09123333333",
  });

  vipAccountId = makeId("wacc");
  await h.db.insert(wholesaleAccount).values({
    id: vipAccountId,
    userId: vipUserId,
    storeName: "Tehran Royal Goods",
    memberName: "Hossein VIP",
    phone: "09123333333",
    city: "تهران",
    status: "approved",
  });

  // 5. Supplier Member
  supplierUserId = makeId("usr_sup_mem");
  await h.db.insert(accountUser).values({
    id: supplierUserId,
    email: "supplier_rep@kolbe.test",
    displayName: "Reza Supplier Rep",
    passwordHash: "h",
    salt: "s",
    role: "supplier",
    status: "active",
  });

  await h.db.insert(supplierMember).values({
    id: makeId("smem"),
    supplierId: ctx.supA,
    userId: supplierUserId,
    role: "owner",
  });
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe("Phase 5.2 Checkpoint D — Multi-Portal Support APIs & Case Operations", () => {
  let createdCustomerCaseId: string;
  let createdVipCaseId: string;
  let createdSupplierCaseId: string;

  // ── 1. Retail Customer Portal API ──────────────────────────
  it("D1: Retail customer creates, lists, and views their case via /support/cases", async () => {
    // 1. Create case
    const createRes = await api()
      .post("/api/v1/support/cases")
      .set("Cookie", cookie(customerAId, "customer"))
      .send({
        category: "ORDER",
        subject: "سفارش ثبت‌شده هنوز ارسال نشده است",
        initialMessage: "سه روز از زمان ثبت سفارش گذشته اما کدی پیامک نشده.",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toMatch(/^case_/);
    expect(createRes.body.publicReference).toMatch(/^SUP-/);
    createdCustomerCaseId = createRes.body.id;

    // 2. List cases
    const listRes = await api()
      .get("/api/v1/support/cases")
      .set("Cookie", cookie(customerAId, "customer"));

    expect(listRes.status).toBe(200);
    expect(listRes.body.cases.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.cases.some((c: any) => c.id === createdCustomerCaseId)).toBe(true);

    // 3. Customer A views case details
    const getRes = await api()
      .get(`/api/v1/support/cases/${createdCustomerCaseId}`)
      .set("Cookie", cookie(customerAId, "customer"));

    expect(getRes.status).toBe(200);
    expect(getRes.body.case.id).toBe(createdCustomerCaseId);
    expect(getRes.body.messages.length).toBe(1);

    // 4. Customer B attempts to access Customer A's case -> 403 Forbidden
    const forbiddenRes = await api()
      .get(`/api/v1/support/cases/${createdCustomerCaseId}`)
      .set("Cookie", cookie(customerBId, "customer"));

    expect(forbiddenRes.status).toBe(403);
  });

  it("D2: Retail customer posts reply message to their open case", async () => {
    const replyRes = await api()
      .post(`/api/v1/support/cases/${createdCustomerCaseId}/messages`)
      .set("Cookie", cookie(customerAId, "customer"))
      .send({
        body: "آیا کد مرسوله پستی صادر شده است؟",
      });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.authorType).toBe("CUSTOMER");
    expect(replyRes.body.body).toContain("کد مرسوله");
  });

  // ── 2. VIP Wholesale Portal API ───────────────────────────
  it("D3: VIP buyer creates case and replies via /vip/support/cases", async () => {
    const createRes = await api()
      .post("/api/v1/vip/support/cases")
      .set("Cookie", cookie(vipUserId, "vip"))
      .send({
        category: "WHOLESALE",
        subject: "درخواست فاکتور رسمی دوره جاری",
        initialMessage: "فاکتور مربوط به پارت دوم خرید عمده مورد نیاز است.",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.requesterType).toBe("VIP_BUYER");
    expect(createRes.body.wholesaleAccountId).toBe(vipAccountId);
    createdVipCaseId = createRes.body.id;

    // List VIP cases
    const listRes = await api()
      .get("/api/v1/vip/support/cases")
      .set("Cookie", cookie(vipUserId, "vip"));

    expect(listRes.status).toBe(200);
    expect(listRes.body.cases.some((c: any) => c.id === createdVipCaseId)).toBe(true);

    // Reply
    const replyRes = await api()
      .post(`/api/v1/vip/support/cases/${createdVipCaseId}/messages`)
      .set("Cookie", cookie(vipUserId, "vip"))
      .send({
        body: "شناسه ملی شرکت در پروفایل به‌روزرسانی شد.",
      });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.authorType).toBe("VIP_BUYER");
  });

  // ── 3. Supplier Support Portal API ────────────────────────
  it("D4: Supplier creates case and replies via /supplier/support/cases", async () => {
    const createRes = await api()
      .post("/api/v1/supplier/support/cases")
      .set("Cookie", cookie(supplierUserId, "supplier"))
      .send({
        category: "SETTLEMENT",
        subject: "اعتراض به تأخیر در واریز تسویه حساب",
        initialMessage: "تسویه دوره منتهی به ۲۵ شهریور هنوز واریز نشده است.",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.requesterType).toBe("SUPPLIER");
    expect(createRes.body.supplierId).toBe(ctx.supA);
    createdSupplierCaseId = createRes.body.id;

    // List supplier cases
    const listRes = await api()
      .get("/api/v1/supplier/support/cases")
      .set("Cookie", cookie(supplierUserId, "supplier"));

    expect(listRes.status).toBe(200);
    expect(listRes.body.cases.some((c: any) => c.id === createdSupplierCaseId)).toBe(true);
  });

  // ── 4. Admin Support Operations API ───────────────────────
  it("D5: Admin manages case lifecycle, assignment, priority, notes, and queues", async () => {
    // 1. Search cases
    const searchRes = await api()
      .get(`/api/v1/admin/support/cases?search=${createdCustomerCaseId}`)
      .set("Cookie", cookie(adminUserId, "admin"));

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.cases.length).toBeGreaterThanOrEqual(1);

    // 2. Change status: OPEN -> IN_PROGRESS
    const statusRes = await api()
      .post(`/api/v1/admin/support/cases/${createdCustomerCaseId}/status`)
      .set("Cookie", cookie(adminUserId, "admin"))
      .send({
        toStatus: "IN_PROGRESS",
        reason: "در دست بررسی کارشناس تحویل",
      });

    expect(statusRes.status).toBe(201);
    expect(statusRes.body.status).toBe("IN_PROGRESS");

    // 3. Assign case to admin
    const assignRes = await api()
      .post(`/api/v1/admin/support/cases/${createdCustomerCaseId}/assign`)
      .set("Cookie", cookie(adminUserId, "admin"))
      .send({
        adminId: adminUserId,
        teamKey: "RETAIL_SUPPORT",
        reason: "ارجاع به کارشناس پیگیری سفارش",
      });

    expect(assignRes.status).toBe(201);
    expect(assignRes.body.assignedAdminId).toBe(adminUserId);

    // 4. Add internal note
    const noteRes = await api()
      .post(`/api/v1/admin/support/cases/${createdCustomerCaseId}/internal-notes`)
      .set("Cookie", cookie(adminUserId, "admin"))
      .send({
        body: "یادداشت محرمانه: هماهنگی تلفنی با پیک منطقه انجام شد.",
        isPinned: true,
      });

    expect(noteRes.status).toBe(201);
    expect(noteRes.body.isPinned).toBe(true);

    // 5. Query operational queues
    const myQueueRes = await api()
      .get("/api/v1/admin/support/queues/my")
      .set("Cookie", cookie(adminUserId, "admin"));

    expect(myQueueRes.status).toBe(200);
    expect(myQueueRes.body.cases.some((c: any) => c.id === createdCustomerCaseId)).toBe(true);

    // 6. Support Control Tower metrics
    const metricsRes = await api()
      .get("/api/v1/admin/support/metrics")
      .set("Cookie", cookie(adminUserId, "admin"));

    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.overview.totalCases).toBeGreaterThan(0);
    expect(metricsRes.body.slaPerformance.totalWithSla).toBeGreaterThan(0);
  });

  // ── 5. Cross-Domain Action References ─────────────────────
  it("D6: records and completes whitelisted cross-domain actions (support_case_action)", async () => {
    // Record action: SHIPMENT_INVESTIGATION
    const recordRes = await api()
      .post(`/api/v1/admin/support/cases/${createdCustomerCaseId}/actions`)
      .set("Cookie", cookie(adminUserId, "admin"))
      .send({
        actionType: "SHIPMENT_INVESTIGATION",
        targetDomain: "shipping",
        targetId: "shipment_123456",
        payload: { priority: "urgent", checkTracking: true },
      });

    expect(recordRes.status).toBe(201);
    expect(recordRes.body.actionType).toBe("SHIPMENT_INVESTIGATION");
    expect(recordRes.body.status).toBe("REQUESTED");
    const actionId = recordRes.body.id;

    // Complete action
    const completeRes = await api()
      .post(`/api/v1/admin/support/actions/${actionId}/complete`)
      .set("Cookie", cookie(adminUserId, "admin"))
      .send({
        status: "EXECUTED",
        resultingReference: "INVESTIGATION_REF_987",
      });

    expect(completeRes.status).toBe(201);
    expect(completeRes.body.status).toBe("EXECUTED");
    expect(completeRes.body.resultingReference).toBe("INVESTIGATION_REF_987");
  });

  // ── 6. Legacy Cutover Adapter ─────────────────────────────
  it("D7: translates legacy wholesale tickets and supplier disputes into canonical support models", () => {
    // 1. Adapt legacy wholesale ticket
    const adaptedCase = LegacyCutoverAdapter.adaptWholesaleTicket(
      {
        id: "TICK-87654321",
        orderCode: "KV-W-100200",
        type: "invoice",
        subject: "نیاز به ارسال مجدد پیش‌فاکتور",
        description: "پیش‌فاکتور قبلی فاقد مهر رسمی بود.",
        status: "open",
        priority: "high",
        createdAt: "2026-09-18T10:00:00Z",
      },
      vipAccountId,
      vipUserId,
    );

    expect(adaptedCase.requesterType).toBe("VIP_BUYER");
    expect(adaptedCase.category).toBe("FINANCE");
    expect(adaptedCase.priority).toBe("HIGH");
    expect(adaptedCase.relations?.[0].targetId).toBe("KV-W-100200");

    // 2. Adapt legacy messages
    const adaptedMessages = LegacyCutoverAdapter.adaptWholesaleMessages("case_legacy_1", [
      {
        id: "msg_1",
        sender: "buyer",
        text: "لطفاً پیش‌فاکتور را بررسی کنید.",
        timestamp: "2026-09-18T10:05:00Z",
      },
      {
        id: "msg_2",
        sender: "admin",
        text: "پیش‌فاکتور ممهور مجدداً ارسال شد.",
        timestamp: "2026-09-18T11:00:00Z",
      },
    ]);

    expect(adaptedMessages.length).toBe(2);
    expect(adaptedMessages[0].author.type).toBe("VIP_BUYER");
    expect(adaptedMessages[1].author.type).toBe("ADMIN");

    // 3. Adapt legacy supplier dispute
    const adaptedDispute = LegacyCutoverAdapter.adaptSupplierDispute(
      {
        id: "disp_999",
        supplierId: ctx.supA,
        orderId: "KV-W-555555",
        reason: "کسورات غیرمجاز در صورت‌حساب",
        status: "pending",
        createdAt: "2026-09-19T08:00:00Z",
      },
      supplierUserId,
    );

    expect(adaptedDispute.requesterType).toBe("SUPPLIER");
    expect(adaptedDispute.category).toBe("SETTLEMENT");
    expect(adaptedDispute.relations?.[0].targetId).toBe("KV-W-555555");
  });
});
