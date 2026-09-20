/**
 * Phase 5.1 — Checkpoint C: Authoritative Customer 360 Read Model Test Suite
 *
 * Verifies:
 * 1. Composed Customer 360 read model for unlinked leads and linked accounts.
 * 2. Factual commerce summaries derived from Orders/Payments/Settlement tables.
 * 3. Exact BIGINT IRR integer arithmetic without float approximations.
 * 4. Refund handling and net spend calculation.
 * 5. Consent reading from Compliance domain without fabricating or defaulting marketing consent.
 * 6. Admin CRM HTTP endpoints with session authentication, AdminPermissionGuard, and IDOR defense.
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountUser,
  adminRole,
  adminRolePermission,
  adminUserRole,
  consentEvent,
  retailOrder,
  wholesaleOrder,
} from "@kolbe/database";
import { CrmContactService } from "../src/modules/crm/crm-contact.service";
import { CrmActivityService } from "../src/modules/crm/crm-activity.service";
import { CrmTaskService } from "../src/modules/crm/crm-task.service";
import { Customer360Service } from "../src/modules/crm/customer-360.service";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_1_customer_360_test";

let h: Harness;
let ctx: SupplierContext;
let contactService: CrmContactService;
let activityService: CrmActivityService;
let taskService: CrmTaskService;
let c360Service: Customer360Service;

let adminCrmViewerId: string;
let adminNoPermsId: string;

const cookie = (userId: string, role = "admin") => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  contactService = h.app.get(CrmContactService);
  activityService = h.app.get(CrmActivityService);
  taskService = h.app.get(CrmTaskService);
  c360Service = h.app.get(Customer360Service);

  // Setup admin users and permissions
  adminCrmViewerId = makeId("adm_crm_vw");
  await h.db.insert(accountUser).values({
    id: adminCrmViewerId,
    email: "crm_viewer@kolbe.test",
    displayName: "کارشناس مشاهده CRM",
    passwordHash: "h",
    salt: "s",
    role: "admin",
    status: "active",
  });

  adminNoPermsId = makeId("adm_no_crm");
  await h.db.insert(accountUser).values({
    id: adminNoPermsId,
    email: "no_crm@kolbe.test",
    displayName: "مدیر بدون دسترسی CRM",
    passwordHash: "h",
    salt: "s",
    role: "admin",
    status: "active",
  });

  // Assign crm:customer:view permission to adminCrmViewerId via custom role
  const roleId = makeId("role_crm");
  await h.db.insert(adminRole).values({
    id: roleId,
    name: "crm_viewer_role",
    displayName: "نقش مشاهده‌گر CRM",
  });

  await h.db.insert(adminRolePermission).values({
    id: makeId("arp"),
    roleId,
    action: "crm:customer:view",
    assignedBy: ctx.userAdmin,
  });

  await h.db.insert(adminUserRole).values({
    id: makeId("aur"),
    userId: adminCrmViewerId,
    roleId,
    assignedBy: ctx.userAdmin,
  });

  // Assign restricted non-crm role to adminNoPermsId
  const nonCrmRoleId = makeId("role_nocrm");
  await h.db.insert(adminRole).values({
    id: nonCrmRoleId,
    name: "non_crm_role",
    displayName: "نقش بدون دسترسی CRM",
  });

  await h.db.insert(adminRolePermission).values({
    id: makeId("arp_non"),
    roleId: nonCrmRoleId,
    action: "wholesale:settings:view",
    assignedBy: ctx.userAdmin,
  });

  await h.db.insert(adminUserRole).values({
    id: makeId("aur_non"),
    userId: adminNoPermsId,
    roleId: nonCrmRoleId,
    assignedBy: ctx.userAdmin,
  });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.1 — Checkpoint C: Customer 360 for Unlinked Leads", () => {
  it("builds a clean 360 profile for a lead with zero commerce and non-recorded consent", async () => {
    const contact = await contactService.createContact(
      {
        name: "پرهام صادقی (لید تبلیغاتی)",
        phone: "09120001122",
        email: "parham.s@example.com",
        city: "کرج",
        stage: "LEAD",
        source: "instagram_ad",
      },
      ctx.userAdmin,
    );

    const data = await c360Service.getCustomer360(contact.id);

    expect(data.contact.id).toBe(contact.id);
    expect(data.contact.name).toBe("پرهام صادقی (لید تبلیغاتی)");
    expect(data.contact.stage).toBe("LEAD");

    // Identity link: none
    expect(data.identity.isLinked).toBe(false);
    expect(data.identity.accountUser).toBeNull();
    expect(data.identity.wholesaleAccount).toBeNull();

    // Commerce: zeroed, no exceptions, BIGINT typed
    expect(data.commerce.totalOrdersCount).toBe(0);
    expect(data.commerce.completedOrdersCount).toBe(0);
    expect(data.commerce.totalSpentRial).toBe(0n);
    expect(data.commerce.refundedAmountRial).toBe(0n);
    expect(data.commerce.netSpentRial).toBe(0n);
    expect(data.commerce.averageOrderValueRial).toBe(0n);
    expect(data.commerce.firstOrderAt).toBeNull();
    expect(data.commerce.lastOrderAt).toBeNull();

    // Compliance: not fabricated, marketing is NOT defaulted to true!
    expect(data.compliance.hasConsentRecord).toBe(false);
    expect(data.compliance.channels.MARKETING_EMAIL.status).toBe("not_recorded");
    expect(data.compliance.channels.MARKETING_SMS.status).toBe("not_recorded");
    expect(data.compliance.channels.PERSONALIZATION.status).toBe("not_recorded");
  });
});

describe("Phase 5.1 — Checkpoint C: Factual Commerce Aggregation & Consent Compliance", () => {
  it("derives authoritative commerce metrics from wholesale and retail orders without float errors", async () => {
    // 1. Create registered account user
    const customerUserId = makeId("usr_c360");
    await h.db.insert(accountUser).values({
      id: customerUserId,
      email: "c360_customer@kolbe.test",
      displayName: "رضا گلزار وینتیج",
      phone: "09301234567",
      passwordHash: "h",
      salt: "s",
      role: "customer",
      status: "active",
    });

    // 2. Create CRM contact & link to customer user
    const contact = await contactService.createContact(
      { name: "رضا گلزار وینتیج", phone: "09301234567" },
      ctx.userAdmin,
    );
    await contactService.linkIdentity(contact.id, customerUserId, ctx.userAdmin);

    // 3. Seed wholesale orders for this user
    // Order 1: Completed wholesale order (150,000,000 IRR)
    await h.db.insert(wholesaleOrder).values({
      id: makeId("wso_1"),
      orderCode: `WO-${Date.now()}-1`,
      accountId: ctx.accId,
      buyerUserId: customerUserId,
      status: "completed",
      grandTotal: 150_000_000n,
      currency: "IRR",
      createdAt: new Date("2026-08-01T10:00:00Z"),
    });

    // Order 2: Confirmed wholesale order (50,000,000 IRR)
    await h.db.insert(wholesaleOrder).values({
      id: makeId("wso_2"),
      orderCode: `WO-${Date.now()}-2`,
      accountId: ctx.accId,
      buyerUserId: customerUserId,
      status: "confirmed",
      grandTotal: 50_000_000n,
      currency: "IRR",
      createdAt: new Date("2026-08-15T12:00:00Z"),
    });

    // Order 3: Cancelled wholesale order (20,000,000 IRR - must NOT count towards spend)
    await h.db.insert(wholesaleOrder).values({
      id: makeId("wso_3"),
      orderCode: `WO-${Date.now()}-3`,
      accountId: ctx.accId,
      buyerUserId: customerUserId,
      status: "cancelled",
      grandTotal: 20_000_000n,
      currency: "IRR",
      createdAt: new Date("2026-08-20T09:00:00Z"),
    });

    // 4. Seed retail orders for this user
    // Order 4: Confirmed retail order (30,000,000 IRR)
    await h.db.insert(retailOrder).values({
      id: makeId("rto_1"),
      orderCode: `RO-${Date.now()}-1`,
      customerId: customerUserId,
      customerName: "رضا گلزار وینتیج",
      phone: "09301234567",
      orderStatus: "confirmed",
      totalAmount: 30_000_000n,
      currency: "IRR",
      createdAt: new Date("2026-09-01T14:00:00Z"),
    });

    // Order 5: Returned retail order (10,000,000 IRR)
    await h.db.insert(retailOrder).values({
      id: makeId("rto_2"),
      orderCode: `RO-${Date.now()}-2`,
      customerId: customerUserId,
      customerName: "رضا گلزار وینتیج",
      phone: "09301234567",
      orderStatus: "returned",
      totalAmount: 10_000_000n,
      currency: "IRR",
      createdAt: new Date("2026-09-10T16:00:00Z"),
    });

    // 5. Seed Compliance consent events
    await h.db.insert(consentEvent).values([
      {
        id: makeId("cev_sms"),
        userId: customerUserId,
        purpose: "MARKETING_SMS",
        eventType: "granted",
        source: "checkout",
        evidenceHash: "hash_sms_grant",
        occurredAt: new Date("2026-08-01T10:05:00Z"),
      },
      {
        id: makeId("cev_email"),
        userId: customerUserId,
        purpose: "MARKETING_EMAIL",
        eventType: "withdrawn",
        source: "portal",
        evidenceHash: "hash_email_revoke",
        occurredAt: new Date("2026-08-05T11:00:00Z"),
      },
    ]);

    // Query 360
    const data = await c360Service.getCustomer360(contact.id);

    // Verify identity
    expect(data.identity.isLinked).toBe(true);
    expect(data.identity.accountUser?.id).toBe(customerUserId);
    expect(data.identity.accountUser?.displayName).toBe("رضا گلزار وینتیج");

    // Verify commerce metrics
    // Total orders: 3 wholesale + 2 retail = 5
    expect(data.commerce.totalOrdersCount).toBe(5);

    // Completed orders: wso_1 (completed) + wso_2 (confirmed) + rto_1 (confirmed) = 3
    expect(data.commerce.completedOrdersCount).toBe(3);

    // Total spend: 150M + 50M (wholesale) + 30M + 10M (retail) = 240,000,000 IRR
    expect(data.commerce.totalSpentRial).toBe(240_000_000n);

    // Refunded amount: 10,000,000 IRR
    expect(data.commerce.refundedAmountRial).toBe(10_000_000n);

    // Net spend: 240M - 10M = 230,000,000 IRR
    expect(data.commerce.netSpentRial).toBe(230_000_000n);

    // Average order value: 240M / 3 = 80,000,000 IRR
    expect(data.commerce.averageOrderValueRial).toBe(80_000_000n);

    // Order dates: first order 2026-08-01, last order 2026-09-10
    expect(data.commerce.firstOrderAt).toEqual(new Date("2026-08-01T10:00:00Z"));
    expect(data.commerce.lastOrderAt).toEqual(new Date("2026-09-10T16:00:00Z"));

    // Recent orders: up to 5 items sorted descending
    expect(data.recentOrders.length).toBeLessThanOrEqual(5);
    expect(data.recentOrders[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      data.recentOrders[1].createdAt.getTime(),
    );

    // Compliance consent: verified without fabricated defaults
    expect(data.compliance.hasConsentRecord).toBe(true);
    expect(data.compliance.channels.MARKETING_SMS.status).toBe("granted");
    expect(data.compliance.channels.MARKETING_SMS.source).toBe("checkout");
    expect(data.compliance.channels.MARKETING_EMAIL.status).toBe("withdrawn");
    expect(data.compliance.channels.MARKETING_PUSH.status).toBe("not_recorded");
  });
});

describe("Phase 5.1 — Checkpoint C: Admin CRM HTTP APIs & IDOR Defense", () => {
  it("enforces session authentication and granular admin permission guard", async () => {
    const contact = await contactService.createContact({ name: "تست دسترسی" }, ctx.userAdmin);

    // 1. Unauthenticated -> 401
    await api().get(`/api/v1/admin/crm/contacts/${contact.id}/360`).expect(401);

    // 2. Buyer session (non-admin) -> 403
    await api()
      .get(`/api/v1/admin/crm/contacts/${contact.id}/360`)
      .set("Cookie", cookie(ctx.userBuyer, "vip"))
      .expect(403);

    // 3. Admin without crm:customer:view -> 403
    await api()
      .get(`/api/v1/admin/crm/contacts/${contact.id}/360`)
      .set("Cookie", cookie(adminNoPermsId, "admin"))
      .expect(403);

    // 4. Admin with crm:customer:view -> 200 with BigInt strings
    const res = await api()
      .get(`/api/v1/admin/crm/contacts/${contact.id}/360`)
      .set("Cookie", cookie(adminCrmViewerId, "admin"))
      .expect(200);

    expect(res.body.contact.id).toBe(contact.id);
    expect(typeof res.body.commerce.totalSpentRial).toBe("string");
    expect(typeof res.body.commerce.netSpentRial).toBe("string");
    expect(typeof res.body.commerce.averageOrderValueRial).toBe("string");
  });

  it("returns 404 for nonexistent contact ID (IDOR defense)", async () => {
    const res = await api()
      .get("/api/v1/admin/crm/contacts/nonexistent_cnt_999/360")
      .set("Cookie", cookie(ctx.userAdmin, "admin"))
      .expect(404);

    expect(res.body.error).toBe("CRM_CONTACT_NOT_FOUND");
  });
});
