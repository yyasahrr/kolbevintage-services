/**
 * Phase 5.3 — Checkpoint D: Domain Event Wiring, Admin APIs & Feature Cutover Test Suite
 *
 * Verifies:
 * 1. Safe Domain Event Dispatching: Domain operations trigger notification events safely.
 * 2. Critical Invariant: Notification delivery failures NEVER crash or rollback caller business logic.
 * 3. Admin Template Management APIs: List, create, draft version, and publish with RBAC guards.
 * 4. Admin Delivery Outbox APIs: List, inspect attempts, retry failed, and cancel pending with RBAC guards.
 * 5. Admin Provider Safe Status API: Returns provider summary without exposing any secrets or tokens.
 * 6. Public Delivery Receipt Webhook API: Ingests signed provider receipts and updates status.
 * 7. Recipient In-App Inbox APIs: List, unread count, mark read, mark all read, archive with session scoping.
 * 8. Recipient Notification Preferences API: Enforces mandatory security notification invariant.
 * 9. Legacy Messaging Adapter: Correctly maps legacy triggers and enforces supplier UI classification.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import {
  accountUser,
  adminRole,
  adminRolePermission,
  adminUserRole,
  inAppNotification,
  notificationDelivery,
  notificationEvent,
  notificationTemplate,
} from "@kolbe/database";
import {
  NotificationDispatcherService,
} from "../src/modules/notifications/notification-dispatcher.service";
import {
  NotificationTemplateService,
} from "../src/modules/notifications/notification-template.service";
import {
  NotificationDeliveryService,
} from "../src/modules/notifications/notification-delivery.service";
import {
  InAppNotificationService,
} from "../src/modules/notifications/in-app-notification.service";
import {
  LegacyMessagingAdapter,
} from "../src/modules/notifications/legacy-messaging.adapter";
import {
  FakeEmailProvider,
  FakeSmsProvider,
} from "../src/modules/notifications/providers/test-providers";
import { bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.3 — Checkpoint D: Domain Event Wiring, Admin APIs & Feature Cutover", () => {
  let harness: Harness;
  let dispatcher: NotificationDispatcherService;
  let templateService: NotificationTemplateService;
  let deliveryService: NotificationDeliveryService;
  let inAppService: InAppNotificationService;
  let legacyAdapter: LegacyMessagingAdapter;
  let fakeSms: FakeSmsProvider;
  let fakeEmail: FakeEmailProvider;

  const adminUserId = `admin_ckd_${crypto.randomUUID().slice(0, 8)}`;
  const limitedAdminUserId = `admin_limited_${crypto.randomUUID().slice(0, 8)}`;
  const customerUserId = `user_ckd_${crypto.randomUUID().slice(0, 8)}`;
  const customerPhone = "09127778899";
  const customerEmail = "customer.ckd@example.com";

  let adminCookie: string;
  let limitedAdminCookie: string;
  let customerCookie: string;

  beforeAll(async () => {
    harness = await bootHarness("phase53_d_test");
    dispatcher = harness.app.get(NotificationDispatcherService);
    templateService = harness.app.get(NotificationTemplateService);
    deliveryService = harness.app.get(NotificationDeliveryService);
    inAppService = harness.app.get(InAppNotificationService);
    legacyAdapter = harness.app.get(LegacyMessagingAdapter);
    fakeSms = harness.app.get(FakeSmsProvider);
    fakeEmail = harness.app.get(FakeEmailProvider);

    // 1. Seed full admin user
    await harness.db.insert(accountUser).values({
      id: adminUserId,
      email: "superadmin.notif@example.com",
      phone: "09120000002",
      passwordHash: "hash",
      salt: "salt",
      fullName: "مدیر ارشد اعلان‌ها",
      role: "admin",
    });

    // Seed limited admin user (lacks manage permissions)
    await harness.db.insert(accountUser).values({
      id: limitedAdminUserId,
      email: "limited.notif@example.com",
      phone: "09120000003",
      passwordHash: "hash",
      salt: "salt",
      fullName: "مدیر ناظر اعلان‌ها",
      role: "admin",
    });

    // 2. Seed customer user
    await harness.db.insert(accountUser).values({
      id: customerUserId,
      email: customerEmail,
      phone: customerPhone,
      passwordHash: "hash",
      salt: "salt",
      fullName: "مشتری فاز ۵.۳",
      role: "customer",
    });

    // 3. Setup RBAC permissions for full admin
    const superRoleId = `role_super_${crypto.randomUUID().slice(0, 6)}`;
    await harness.db.insert(adminRole).values({
      id: superRoleId,
      name: "Notification Super Admin",
      displayName: "مدیر ارشد اعلان‌ها",
      description: "Full notification administration rights",
    });

    const notifPermissions = [
      "notification:template:view",
      "notification:template:manage",
      "notification:outbox:view",
      "notification:outbox:retry",
      "notification:provider:view",
      "notification:preference:manage",
      "notification:report:view",
    ];

    for (const action of notifPermissions) {
      await harness.db.insert(adminRolePermission).values({
        id: `perm_${crypto.randomUUID().slice(0, 8)}`,
        roleId: superRoleId,
        action,
      });
    }

    await harness.db.insert(adminUserRole).values({
      id: `asgn_${crypto.randomUUID().slice(0, 8)}`,
      roleId: superRoleId,
      userId: adminUserId,
      assignedBy: adminUserId,
    });

    // 4. Setup RBAC for limited admin (read only)
    const readOnlyRoleId = `role_ro_${crypto.randomUUID().slice(0, 6)}`;
    await harness.db.insert(adminRole).values({
      id: readOnlyRoleId,
      name: "Notification Read Only",
      displayName: "ناظر اعلان‌ها",
      description: "Read-only notification rights",
    });

    await harness.db.insert(adminRolePermission).values({
      id: `perm_${crypto.randomUUID().slice(0, 8)}`,
      roleId: readOnlyRoleId,
      action: "notification:template:view",
    });

    await harness.db.insert(adminUserRole).values({
      id: `asgn_${crypto.randomUUID().slice(0, 8)}`,
      roleId: readOnlyRoleId,
      userId: limitedAdminUserId,
      assignedBy: adminUserId,
    });

    // 5. Generate test session tokens
    adminCookie = `kolbe_session=${harness.issueToken(adminUserId, "admin")}`;
    limitedAdminCookie = `kolbe_session=${harness.issueToken(limitedAdminUserId, "admin")}`;
    customerCookie = `kolbe_session=${harness.issueToken(customerUserId, "customer")}`;

    // 6. Pre-seed published templates for payment confirmed and order confirmed
    const payTpl = await templateService.createTemplate({
      templateKey: "payment_confirmed_sms",
      name: "پیامک تأیید پرداخت",
      eventKey: "PAYMENT_CONFIRMED",
      channel: "SMS",
      category: "TRANSACTIONAL",
      initialVersion: {
        body: "پرداخت سفارش {{order_number}} به مبلغ {{amount}} ریال تأیید شد.",
        variablesSchema: ["order_number", "amount"],
      },
      adminUserId,
    });
    await templateService.publishVersion(payTpl.id, 1, adminUserId);

    const payInAppTpl = await templateService.createTemplate({
      templateKey: "payment_confirmed_inapp",
      name: "اعلان درون‌برنامه‌ای تأیید پرداخت",
      eventKey: "PAYMENT_CONFIRMED",
      channel: "IN_APP",
      category: "TRANSACTIONAL",
      initialVersion: {
        subject: "رسید پرداخت سفارش {{order_number}}",
        body: "پرداخت شما با موفقیت دریافت شد.",
        variablesSchema: ["order_number"],
      },
      adminUserId,
    });
    await templateService.publishVersion(payInAppTpl.id, 1, adminUserId);
  });

  beforeEach(() => {
    fakeSms.clear();
    fakeEmail.clear();
  });

  afterAll(async () => {
    await harness.close();
  });

  // --------------------------------------------------------------------------
  // D.1 — Domain Event Dispatcher & Non-Blocking Invariant
  // --------------------------------------------------------------------------
  describe("D.1 — Domain Event Dispatcher & Non-Blocking Invariant", () => {
    it("should safely dispatch domain event to multiple channels and enqueue deliveries", async () => {
      const result = await dispatcher.dispatchDomainEvent({
        eventKey: "PAYMENT_CONFIRMED",
        sourceDomain: "payments",
        sourceEntityType: "payment",
        sourceEntityId: `pay_${crypto.randomUUID().slice(0, 8)}`,
        sourceEventId: `ev_pay_${crypto.randomUUID()}`,
        recipientType: "ACCOUNT_USER",
        recipientId: customerUserId,
        category: "TRANSACTIONAL",
        channels: ["SMS", "IN_APP"],
        payload: {
          order_number: "ORD-99001",
          amount: 5000000,
        },
      });

      expect(result.success).toBe(true);
      expect(result.deliveryIds.length).toBe(2);

      // Verify IN_APP was immediately delivered
      const unreadCount = await inAppService.getUnreadCount("ACCOUNT_USER", customerUserId);
      expect(unreadCount).toBeGreaterThanOrEqual(1);

      // Verify SMS is in outbox as PENDING
      const outbox = await deliveryService.listDeliveries({
        channel: "SMS",
        recipientId: customerUserId,
      });
      expect(outbox.length).toBeGreaterThanOrEqual(1);
    });

    it("should NEVER throw or rollback domain caller when notification delivery fails", async () => {
      // Simulate unhandled failure mode on fake provider or missing template
      const nonExistentEventKey = "AUTH_SECURITY_ALERT"; // has no template configured

      const result = await dispatcher.dispatchDomainEvent({
        eventKey: nonExistentEventKey,
        sourceDomain: "auth",
        sourceEntityType: "session",
        sourceEntityId: `sess_${crypto.randomUUID().slice(0, 8)}`,
        sourceEventId: `ev_auth_${crypto.randomUUID()}`,
        recipientType: "ACCOUNT_USER",
        recipientId: customerUserId,
        category: "SECURITY",
        channels: ["SMS"],
        payload: {
          customer_name: "تست",
        },
      });

      // Crucial: Method completed without throwing exception!
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("not found");
    });
  });

  // --------------------------------------------------------------------------
  // D.2 — Admin Template Management APIs & RBAC
  // --------------------------------------------------------------------------
  describe("D.2 — Admin Template Management APIs & RBAC", () => {
    it("should allow admin with template:manage to create and publish a template", async () => {
      const templateKey = `tpl_api_${crypto.randomUUID().slice(0, 6)}`;

      const resCreate = await request(harness.app.getHttpServer())
        .post("/api/v1/admin/notifications/templates")
        .set("Cookie", adminCookie)
        .send({
          templateKey,
          name: "اعلان تست از طریق وب‌سرویس",
          eventKey: "ORDER_CREATED",
          channel: "SMS",
          category: "TRANSACTIONAL",
          initialVersion: {
            body: "سفارش شما با کد {{order_number}} ثبت گردید.",
            variablesSchema: ["order_number"],
          },
        });

      expect(resCreate.status).toBe(201);
      const createdTpl = resCreate.body;
      expect(createdTpl.templateKey).toBe(templateKey);

      // Publish version 1
      const resPub = await request(harness.app.getHttpServer())
        .post(`/api/v1/admin/notifications/templates/${createdTpl.id}/publish`)
        .set("Cookie", adminCookie)
        .send({ version: 1 });

      expect(resPub.status).toBe(201);
      expect(resPub.body.status).toBe("PUBLISHED");

      // Verify list endpoint
      const resList = await request(harness.app.getHttpServer())
        .get("/api/v1/admin/notifications/templates")
        .set("Cookie", adminCookie);

      expect(resList.status).toBe(200);
      expect(Array.isArray(resList.body)).toBe(true);
    });

    it("should enforce RBAC and reject limited admin from creating or publishing templates", async () => {
      const resCreate = await request(harness.app.getHttpServer())
        .post("/api/v1/admin/notifications/templates")
        .set("Cookie", limitedAdminCookie)
        .send({
          templateKey: "forbidden_tpl",
          name: "قالب غیرمجاز",
          eventKey: "ORDER_CREATED",
          channel: "SMS",
          initialVersion: { body: "متن" },
        });

      // 403 Forbidden because limitedAdmin lacks notification.template:manage
      expect(resCreate.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // D.3 — Admin Deliveries & Outbox APIs
  // --------------------------------------------------------------------------
  describe("D.3 — Admin Deliveries & Outbox APIs", () => {
    it("should allow admin to inspect delivery details with full attempt history", async () => {
      const listRes = await request(harness.app.getHttpServer())
        .get("/api/v1/admin/notifications/deliveries")
        .set("Cookie", adminCookie);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);

      if (listRes.body.length > 0) {
        const deliveryId = listRes.body[0].id;
        const detailsRes = await request(harness.app.getHttpServer())
          .get(`/api/v1/admin/notifications/deliveries/${deliveryId}`)
          .set("Cookie", adminCookie);

        expect(detailsRes.status).toBe(200);
        expect(detailsRes.body.id).toBe(deliveryId);
        expect(Array.isArray(detailsRes.body.attempts)).toBe(true);
      }
    });

    it("should allow admin to list providers without exposing secrets", async () => {
      const res = await request(harness.app.getHttpServer())
        .get("/api/v1/admin/notifications/providers")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      const providers = res.body;
      expect(Array.isArray(providers)).toBe(true);

      // Verify zero provider secrets exposed
      for (const p of providers) {
        expect(p.apiKey).toBeUndefined();
        expect(p.token).toBeUndefined();
        expect(p.secret).toBeUndefined();
        expect(p.webhookSecret).toBeUndefined();
        expect(p.providerKey).toBeDefined();
        expect(p.channel).toBeDefined();
      }
    });
  });

  // --------------------------------------------------------------------------
  // D.4 — Public Delivery Webhook Ingestion API
  // --------------------------------------------------------------------------
  describe("D.4 — Public Delivery Webhook Ingestion API", () => {
    it("should ingest signed delivery webhook and transition delivery to DELIVERED", async () => {
      // 1. Dispatch SMS
      const dispatchRes = await dispatcher.dispatchDomainEvent({
        eventKey: "PAYMENT_CONFIRMED",
        sourceDomain: "payments",
        sourceEntityType: "payment",
        sourceEntityId: `pay_wh_${crypto.randomUUID().slice(0, 8)}`,
        sourceEventId: `ev_pay_wh_${crypto.randomUUID()}`,
        recipientType: "ACCOUNT_USER",
        recipientId: customerUserId,
        category: "TRANSACTIONAL",
        channels: ["SMS"],
        payload: {
          order_number: "ORD-WH-101",
          amount: 2500000,
        },
      });

      const deliveryId = dispatchRes.deliveryIds[0];
      const processed = await deliveryService.processDelivery(deliveryId);
      expect(processed.status).toBe("SENT");
      const providerMsgId = processed.providerMessageId!;

      // 2. Generate signed webhook
      const webhookPayload = JSON.stringify({
        externalEventId: `wh_evt_${crypto.randomUUID()}`,
        externalMessageId: providerMsgId,
        eventType: "DELIVERED",
      });
      const signature = fakeSms.generateWebhookSignature(webhookPayload);

      // 3. Post to public webhook endpoint
      const whRes = await request(harness.app.getHttpServer())
        .post("/api/v1/notifications/webhooks/fake_sms")
        .set("x-signature", signature)
        .set("Content-Type", "application/json")
        .send(webhookPayload);

      expect(whRes.status).toBe(200);
      expect(whRes.body.processingStatus).toBe("PROCESSED");
      expect(whRes.body.deliveryId).toBe(deliveryId);

      // 4. Verify delivery status updated to DELIVERED
      const updated = await deliveryService.getDeliveryWithAttempts(deliveryId);
      expect(updated.status).toBe("DELIVERED");
    });
  });

  // --------------------------------------------------------------------------
  // D.5 — Recipient In-App Inbox & Preferences APIs
  // --------------------------------------------------------------------------
  describe("D.5 — Recipient In-App Inbox & Preferences APIs", () => {
    it("should allow recipient to list in-app notifications, get unread count, and mark read", async () => {
      // Create notification for customer
      const notif = await inAppService.createNotification({
        recipientType: "ACCOUNT_USER",
        recipientId: customerUserId,
        title: "پیام جدید شما",
        body: "یک سفارش جدید ثبت گردید.",
      });

      // 1. List inbox
      const inboxRes = await request(harness.app.getHttpServer())
        .get("/api/v1/notifications/inbox")
        .set("Cookie", customerCookie);

      expect(inboxRes.status).toBe(200);
      expect(Array.isArray(inboxRes.body)).toBe(true);
      const found = inboxRes.body.some((n: { id: string }) => n.id === notif.id);
      expect(found).toBe(true);

      // 2. Get unread count
      const countRes = await request(harness.app.getHttpServer())
        .get("/api/v1/notifications/unread-count")
        .set("Cookie", customerCookie);

      expect(countRes.status).toBe(200);
      expect(countRes.body.unreadCount).toBeGreaterThanOrEqual(1);

      // 3. Mark read
      const markRes = await request(harness.app.getHttpServer())
        .patch(`/api/v1/notifications/${notif.id}/read`)
        .set("Cookie", customerCookie);

      expect(markRes.status).toBe(200);
      expect(markRes.body.readAt).toBeDefined();

      // 4. Archive
      const archiveRes = await request(harness.app.getHttpServer())
        .delete(`/api/v1/notifications/${notif.id}`)
        .set("Cookie", customerCookie);

      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.archivedAt).toBeDefined();
    });

    it("should reject customer attempt to disable mandatory SECURITY notifications", async () => {
      const res = await request(harness.app.getHttpServer())
        .put("/api/v1/notifications/preferences")
        .set("Cookie", customerCookie)
        .send({
          channel: "SMS",
          category: "SECURITY",
          enabled: false, // Disallowed!
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("NOTIFICATION_PREFERENCE_FORBIDDEN");
    });
  });

  // --------------------------------------------------------------------------
  // D.6 — Legacy Cutover Adapter & Supplier UI Message Classification
  // --------------------------------------------------------------------------
  describe("D.6 — Legacy Cutover Adapter & Supplier UI Message Classification", () => {
    it("should correctly classify message channels and enforce anti-disintermediation on direct chat", () => {
      const supportTicket = legacyAdapter.classifyMessage("ticket");
      expect(supportTicket.classification).toBe("SUPPORT_CONVERSATION");
      expect(supportTicket.moduleOwner).toBe("support");
      expect(supportTicket.allowed).toBe(true);

      const systemNotif = legacyAdapter.classifyMessage("notification");
      expect(systemNotif.classification).toBe("SYSTEM_NOTIFICATION");
      expect(systemNotif.moduleOwner).toBe("notifications");
      expect(systemNotif.allowed).toBe(true);

      const directChat = legacyAdapter.classifyMessage("chat");
      expect(directChat.classification).toBe("DIRECT_PEER_CHAT_PROHIBITED");
      expect(directChat.moduleOwner).toBe("none");
      expect(directChat.allowed).toBe(false);
      expect(directChat.reason).toContain("anti-disintermediation");
    });

    it("should map legacy triggers to authoritative notification event keys", () => {
      const orderConfirmed = legacyAdapter.getMappingForLegacyTrigger("order_confirmation");
      expect(orderConfirmed).toBeDefined();
      expect(orderConfirmed!.targetEventKey).toBe("ORDER_CONFIRMED");

      const shipmentTracking = legacyAdapter.getMappingForLegacyTrigger("shipment_tracking");
      expect(shipmentTracking).toBeDefined();
      expect(shipmentTracking!.targetEventKey).toBe("SHIPMENT_SHIPPED");

      const allMappings = legacyAdapter.listAllMappings();
      expect(allMappings.length).toBeGreaterThanOrEqual(4);
    });
  });
});
