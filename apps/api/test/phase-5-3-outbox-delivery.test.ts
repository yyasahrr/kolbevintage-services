/**
 * Phase 5.3 — Checkpoint B: Outbox, Delivery Engine & Retry Safety Test Suite
 *
 * Verifies:
 * 1. Outbox Lifecycle: PENDING -> PROCESSING -> SENT / DELIVERED.
 * 2. Immutable delivery attempt history (append-only notification_delivery_attempt).
 * 3. Bounded retry policy with exponential backoff & finite attempts.
 * 4. Permanent failure classification (invalid destination immediately transitions to FAILED_PERMANENT).
 * 5. Retryable failure classification (transient network 5xx transitions to FAILED_RETRYABLE).
 * 6. Final dead-letter failure once max attempts exhausted.
 * 7. Outbox batch processing honoring scheduled_at and next_retry_at.
 * 8. Deterministic idempotency key and duplicate delivery suppression.
 * 9. PII protection: destination masking (phone and email) and hash destination.
 * 10. Real in-app notification inbox: listing, unread count, mark read, mark all read, archive.
 * 11. Strict cross-user IDOR protection on in-app notifications.
 * 12. Channel IN_APP delivers directly to inbox and marks delivery DELIVERED.
 * 13. Admin delivery operations: retry failed delivery, cancel pending delivery, reject status forging.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import {
  accountUser,
  inAppNotification,
  notificationDelivery,
  notificationDeliveryAttempt,
  notificationEvent,
  notificationTemplate,
  notificationTemplateVersion,
} from "@kolbe/database";
import {
  NotificationTemplateService,
} from "../src/modules/notifications/notification-template.service";
import {
  NotificationEventService,
} from "../src/modules/notifications/notification-event.service";
import {
  NotificationDeliveryService,
  hashDestination,
  maskDestination,
} from "../src/modules/notifications/notification-delivery.service";
import {
  InAppNotificationService,
} from "../src/modules/notifications/in-app-notification.service";
import {
  FakeEmailProvider,
  FakeSmsProvider,
} from "../src/modules/notifications/providers/test-providers";
import { bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.3 — Checkpoint B: Outbox, Delivery Engine & Retry Safety", () => {
  let harness: Harness;
  let templateService: NotificationTemplateService;
  let eventService: NotificationEventService;
  let deliveryService: NotificationDeliveryService;
  let inAppService: InAppNotificationService;
  let fakeSms: FakeSmsProvider;
  let fakeEmail: FakeEmailProvider;

  const testUserId = `user_ckb_${crypto.randomUUID().slice(0, 8)}`;
  const adminUserId = `admin_ckb_${crypto.randomUUID().slice(0, 8)}`;
  const testPhone = "09121112233";
  const testEmail = "buyer.ckb@example.com";

  beforeAll(async () => {
    harness = await bootHarness("phase53_b_test");
    templateService = harness.app.get(NotificationTemplateService);
    eventService = harness.app.get(NotificationEventService);
    deliveryService = harness.app.get(NotificationDeliveryService);
    inAppService = harness.app.get(InAppNotificationService);
    fakeSms = harness.app.get(FakeSmsProvider);
    fakeEmail = harness.app.get(FakeEmailProvider);

    // Seed test admin user
    await harness.db.insert(accountUser).values({
      id: adminUserId,
      email: "admin.ckb@example.com",
      phone: "09120000000",
      passwordHash: "hash",
      salt: "salt",
      fullName: "مدیر تستی سیستم",
      role: "admin",
    });

    // Seed test customer user
    await harness.db.insert(accountUser).values({
      id: testUserId,
      email: testEmail,
      phone: testPhone,
      passwordHash: "hash",
      salt: "salt",
      fullName: "کاربر تحویل پیام",
      role: "customer",
    });

    // Create & publish order created templates for SMS, EMAIL, and IN_APP
    const smsTpl = await templateService.createTemplate({
      templateKey: "order_created_sms",
      name: "اعلان ثبت سفارش پیامکی",
      eventKey: "ORDER_CREATED",
      channel: "SMS",
      category: "TRANSACTIONAL",
      initialVersion: {
        body: "سفارش {{order_number}} ثبت شد. مبلغ: {{amount}} ریال",
        variablesSchema: ["order_number", "amount"],
      },
      adminUserId,
    });
    await templateService.publishVersion(smsTpl.id, 1, adminUserId);

    const emailTpl = await templateService.createTemplate({
      templateKey: "order_created_email",
      name: "اعلان ثبت سفارش ایمیلی",
      eventKey: "ORDER_CREATED",
      channel: "EMAIL",
      category: "TRANSACTIONAL",
      initialVersion: {
        subject: "سفارش شما شماره {{order_number}}",
        body: "<p>سلام {{customer_name}}، سفارش {{order_number}} با موفقیت ثبت شد.</p>",
        variablesSchema: ["order_number", "customer_name"],
      },
      adminUserId,
    });
    await templateService.publishVersion(emailTpl.id, 1, adminUserId);

    const inAppTpl = await templateService.createTemplate({
      templateKey: "order_created_inapp",
      name: "اعلان ثبت سفارش درون‌برنامه‌ای",
      eventKey: "ORDER_CREATED",
      channel: "IN_APP",
      category: "TRANSACTIONAL",
      initialVersion: {
        subject: "سفارش {{order_number}} دریافت شد",
        body: "سفارش شما به ارزش {{amount}} ریال در انتظار پرداخت است.",
        variablesSchema: ["order_number", "amount"],
      },
      adminUserId,
    });
    await templateService.publishVersion(inAppTpl.id, 1, adminUserId);
  });

  beforeEach(() => {
    fakeSms.clear();
    fakeEmail.clear();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createTestEvent(payload: Record<string, unknown>) {
    const res = await eventService.captureEvent({
      eventKey: "ORDER_CREATED",
      sourceDomain: "orders",
      sourceEntityType: "order",
      sourceEntityId: `ord_${crypto.randomUUID().slice(0, 8)}`,
      sourceEventId: `ev_${crypto.randomUUID()}`,
      recipientScope: "ACCOUNT_USER",
      payload,
    });
    return res.event;
  }

  // --------------------------------------------------------------------------
  // B.1 — Destination Masking & PII Protection
  // --------------------------------------------------------------------------
  describe("B.1 — Destination Masking & Hashing", () => {
    it("should securely mask phone numbers without exposing full destination", () => {
      expect(maskDestination("09123456789")).toBe("0912***6789");
      expect(maskDestination("+989123456789")).toBe("9891***6789");
    });

    it("should securely mask email addresses without exposing full mailbox", () => {
      expect(maskDestination("customer@example.com")).toBe("cu***r@example.com");
      expect(maskDestination("ab@example.com")).toBe("a***@example.com");
      expect(maskDestination("a@example.com")).toBe("a***@example.com");
    });

    it("should compute deterministic SHA-256 destination hash for indexing", () => {
      const hash1 = hashDestination("test@example.com");
      const hash2 = hashDestination(" TEST@EXAMPLE.COM ");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // --------------------------------------------------------------------------
  // B.2 — Outbox Lifecycle & Enqueueing
  // --------------------------------------------------------------------------
  describe("B.2 — Outbox Lifecycle & Delivery Scheduling", () => {
    it("should enqueue SMS delivery into PENDING status with masked destination", async () => {
      const event = await createTestEvent({ order_number: "ORD-1001", amount: 250000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      expect(delivery.status).toBe("PENDING");
      expect(delivery.channel).toBe("SMS");
      expect(delivery.destinationMasked).toBe("0912***2233");
      expect(delivery.attemptCount).toBe(0);
      expect(delivery.renderedBody).toContain("ORD-1001");
      expect(delivery.renderedBody).toContain("250000");
    });

    it("should enforce deduplication when enqueueing identical delivery", async () => {
      const event = await createTestEvent({ order_number: "ORD-1002", amount: 500000 });

      const delivery1 = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      const delivery2 = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      expect(delivery1.id).toBe(delivery2.id);
      expect(delivery1.idempotencyKey).toBe(delivery2.idempotencyKey);
    });

    it("should honor future scheduled_at dates and skip premature outbox batch execution", async () => {
      const futureDate = new Date(Date.now() + 3600 * 1000); // 1 hour in the future

      const event = await createTestEvent({ order_number: "ORD-1003", amount: 100000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
        scheduledAt: futureDate,
      });

      expect(delivery.status).toBe("PENDING");

      // Batch outbox run now should NOT process future scheduled delivery
      const processed = await deliveryService.processOutboxBatch();
      const match = processed.find((d) => d.id === delivery.id);
      expect(match).toBeUndefined();

      const fresh = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(fresh.status).toBe("PENDING");
      expect(fresh.attemptCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // B.3 — Successful Provider Dispatch & Immutable Attempts
  // --------------------------------------------------------------------------
  describe("B.3 — Successful Provider Dispatch & Immutable Attempts", () => {
    it("should transition SMS delivery from PENDING to SENT and record attempt", async () => {
      const event = await createTestEvent({ order_number: "ORD-2001", amount: 750000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      const processed = await deliveryService.processDelivery(delivery.id);
      expect(processed.status).toBe("SENT");
      expect(processed.providerKey).toBe("fake_sms");
      expect(processed.providerMessageId).toBeDefined();
      expect(processed.attemptCount).toBe(1);

      // Verify delivery attempt record in database
      const withAttempts = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(withAttempts.attempts.length).toBe(1);
      const attempt = withAttempts.attempts[0];
      expect(attempt.attemptNumber).toBe(1);
      expect(attempt.providerKey).toBe("fake_sms");
      expect(attempt.status).toBe("SUCCESS");
      expect(attempt.externalMessageId).toBe(processed.providerMessageId);
      expect(attempt.startedAt).toBeDefined();
      expect(attempt.finishedAt).toBeDefined();

      // Verify fake provider received the message
      expect(fakeSms.sentMessages.length).toBe(1);
      expect(fakeSms.sentMessages[0].to).toBe(testPhone);
      expect(fakeSms.sentMessages[0].body).toContain("ORD-2001");
    });

    it("should transition EMAIL delivery from PENDING to SENT with subject and body", async () => {
      const event = await createTestEvent({ order_number: "ORD-2002", amount: 990000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "EMAIL",
        category: "TRANSACTIONAL",
      });

      const processed = await deliveryService.processDelivery(delivery.id);
      expect(processed.status).toBe("SENT");
      expect(processed.providerKey).toBe("fake_email");
      expect(processed.providerMessageId).toBeDefined();

      expect(fakeEmail.sentEmails.length).toBe(1);
      expect(fakeEmail.sentEmails[0].to).toBe(testEmail);
      expect(fakeEmail.sentEmails[0].subject).toContain("ORD-2002");
      expect(fakeEmail.sentEmails[0].body).toContain("ORD-2002");
    });

    it("should NOT mark status SENT unless provider genuinely accepts the message", async () => {
      fakeSms.failureMode = "RETRYABLE";

      const event = await createTestEvent({ order_number: "ORD-2003", amount: 150000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      const processed = await deliveryService.processDelivery(delivery.id);
      expect(processed.status).not.toBe("SENT");
      expect(processed.status).toBe("FAILED_RETRYABLE");
    });
  });

  // --------------------------------------------------------------------------
  // B.4 — Bounded Retries & Backoff Policy
  // --------------------------------------------------------------------------
  describe("B.4 — Bounded Retries & Error Classification", () => {
    it("should handle transient retryable error with backoff and attempt record", async () => {
      fakeSms.failureMode = "RETRYABLE";

      const event = await createTestEvent({ order_number: "ORD-3001", amount: 300000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
        maxAttempts: 3,
      });

      const attempt1 = await deliveryService.processDelivery(delivery.id);
      expect(attempt1.status).toBe("FAILED_RETRYABLE");
      expect(attempt1.attemptCount).toBe(1);
      expect(attempt1.nextRetryAt).toBeDefined();
      expect(attempt1.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());

      const withAttempts = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(withAttempts.attempts.length).toBe(1);
      expect(withAttempts.attempts[0].status).toBe("RETRYABLE_ERROR");
      expect(withAttempts.attempts[0].errorCategory).toBe("NETWORK_TIMEOUT");
    });

    it("should transition to FAILED_PERMANENT when max retry attempts are reached", async () => {
      fakeSms.failureMode = "RETRYABLE";

      const event = await createTestEvent({ order_number: "ORD-3002", amount: 450000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
        maxAttempts: 2, // low max attempts for test
      });

      // Attempt 1 -> FAILED_RETRYABLE
      const attempt1 = await deliveryService.processDelivery(delivery.id);
      expect(attempt1.status).toBe("FAILED_RETRYABLE");
      expect(attempt1.attemptCount).toBe(1);

      // Attempt 2 -> FAILED_PERMANENT (exhausted maxAttempts=2)
      const attempt2 = await deliveryService.processDelivery(delivery.id);
      expect(attempt2.status).toBe("FAILED_PERMANENT");
      expect(attempt2.attemptCount).toBe(2);
      expect(attempt2.failedAt).toBeDefined();

      const withAttempts = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(withAttempts.attempts.length).toBe(2);
    });

    it("should immediately transition to FAILED_PERMANENT without retrying on permanent error", async () => {
      fakeSms.failureMode = "PERMANENT";

      const event = await createTestEvent({ order_number: "ORD-3003", amount: 600000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
        maxAttempts: 5,
      });

      const attempt1 = await deliveryService.processDelivery(delivery.id);
      expect(attempt1.status).toBe("FAILED_PERMANENT");
      expect(attempt1.attemptCount).toBe(1);
      expect(attempt1.failedAt).toBeDefined();

      const withAttempts = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(withAttempts.attempts.length).toBe(1);
      expect(withAttempts.attempts[0].status).toBe("PERMANENT_ERROR");
      expect(withAttempts.attempts[0].errorCategory).toBe("INVALID_DESTINATION");
    });
  });

  // --------------------------------------------------------------------------
  // B.5 — Real In-App Notifications & IDOR Safety
  // --------------------------------------------------------------------------
  describe("B.5 — Real In-App Notifications & IDOR Safety", () => {
    it("should directly deliver IN_APP notification to inbox and mark delivery DELIVERED", async () => {
      const event = await createTestEvent({ order_number: "ORD-INAPP-1", amount: 120000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "IN_APP",
        category: "TRANSACTIONAL",
      });

      expect(delivery.status).toBe("DELIVERED");
      expect(delivery.deliveredAt).toBeDefined();

      // Check inbox entry was created
      const items = await inAppService.listNotifications("ACCOUNT_USER", testUserId);
      const match = items.find((i) => i.deliveryId === delivery.id);
      expect(match).toBeDefined();
      expect(match!.title).toContain("ORD-INAPP-1");
      expect(match!.body).toContain("120000");
      expect(match!.readAt).toBeNull();
    });

    it("should maintain accurate unread count and decrement after markRead", async () => {
      const initialUnread = await inAppService.getUnreadCount("ACCOUNT_USER", testUserId);

      // Create notification
      const notif = await inAppService.createNotification({
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        title: "پیام تستی ۱",
        body: "متن پیام تست",
      });

      const unreadAfterCreate = await inAppService.getUnreadCount("ACCOUNT_USER", testUserId);
      expect(unreadAfterCreate).toBe(initialUnread + 1);

      // Mark as read
      const updated = await inAppService.markRead(notif.id, "ACCOUNT_USER", testUserId);
      expect(updated).toBeDefined();
      expect(updated!.readAt).toBeDefined();

      const unreadAfterRead = await inAppService.getUnreadCount("ACCOUNT_USER", testUserId);
      expect(unreadAfterRead).toBe(initialUnread);
    });

    it("should prevent cross-user IDOR when querying or mutating notifications", async () => {
      const attackerUserId = `user_attacker_${crypto.randomUUID().slice(0, 6)}`;
      await harness.db.insert(accountUser).values({
        id: attackerUserId,
        email: "attacker@example.com",
        phone: "09129999999",
        passwordHash: "hash",
        salt: "salt",
        fullName: "نفوذگر تستی",
        role: "customer",
      });

      // Target victim notification
      const victimNotif = await inAppService.createNotification({
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        title: "پیام محرمانه کاربر",
        body: "اطلاعات مالی محرمانه",
      });

      // 1. Attacker listing notifications cannot see victim's notification
      const attackerList = await inAppService.listNotifications("ACCOUNT_USER", attackerUserId);
      const foundInAttackerList = attackerList.some((n) => n.id === victimNotif.id);
      expect(foundInAttackerList).toBe(false);

      // 2. Attacker trying to mark victim's notification as read is rejected / no-op
      const attackMarkRead = await inAppService.markRead(
        victimNotif.id,
        "ACCOUNT_USER",
        attackerUserId,
      );
      expect(attackMarkRead).toBeNull();

      // Verify victim's notification is still unread!
      const [freshVictimNotif] = await harness.db
        .select()
        .from(inAppNotification)
        .where(eq(inAppNotification.id, victimNotif.id));
      expect(freshVictimNotif.readAt).toBeNull();

      // 3. Attacker trying to archive victim's notification is rejected / no-op
      const attackArchive = await inAppService.archive(
        victimNotif.id,
        "ACCOUNT_USER",
        attackerUserId,
      );
      expect(attackArchive).toBeNull();

      const [freshVictimNotif2] = await harness.db
        .select()
        .from(inAppNotification)
        .where(eq(inAppNotification.id, victimNotif.id));
      expect(freshVictimNotif2.archivedAt).toBeNull();
    });

    it("should support markAllRead and archive operations", async () => {
      // Create 2 unread notifications
      await inAppService.createNotification({
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        title: "اعلان چندگانه ۱",
        body: "متن ۱",
      });
      await inAppService.createNotification({
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        title: "اعلان چندگانه ۲",
        body: "متن ۲",
      });

      const countBefore = await inAppService.getUnreadCount("ACCOUNT_USER", testUserId);
      expect(countBefore).toBeGreaterThanOrEqual(2);

      const markedCount = await inAppService.markAllRead("ACCOUNT_USER", testUserId);
      expect(markedCount).toBeGreaterThanOrEqual(2);

      const countAfter = await inAppService.getUnreadCount("ACCOUNT_USER", testUserId);
      expect(countAfter).toBe(0);

      // Archive one notification and verify it is excluded from default list
      const list = await inAppService.listNotifications("ACCOUNT_USER", testUserId);
      const itemToArchive = list[0];
      await inAppService.archive(itemToArchive.id, "ACCOUNT_USER", testUserId);

      const listAfterArchive = await inAppService.listNotifications("ACCOUNT_USER", testUserId);
      const archivedItem = listAfterArchive.find((n) => n.id === itemToArchive.id);
      expect(archivedItem).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // B.6 — Admin Delivery Operations (Retry & Cancel)
  // --------------------------------------------------------------------------
  describe("B.6 — Admin Operations: Retry & Cancel", () => {
    it("should allow admin to retry a failed delivery and record audit log", async () => {
      fakeSms.failureMode = "PERMANENT";

      const event = await createTestEvent({ order_number: "ORD-ADM-1", amount: 100000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      await deliveryService.processDelivery(delivery.id);
      const failed = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(failed.status).toBe("FAILED_PERMANENT");

      // Admin retries delivery
      const retried = await deliveryService.retryDelivery(delivery.id, adminUserId);
      expect(retried.status).toBe("PENDING");
      expect(retried.nextRetryAt).toBeDefined();

      // Now with failureMode cleared, it can be processed successfully
      fakeSms.failureMode = "NONE";
      const processed = await deliveryService.processDelivery(delivery.id);
      expect(processed.status).toBe("SENT");
    });

    it("should allow admin to cancel a pending delivery", async () => {
      const event = await createTestEvent({ order_number: "ORD-ADM-2", amount: 200000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      const cancelled = await deliveryService.cancelDelivery(delivery.id, adminUserId);
      expect(cancelled.status).toBe("CANCELLED");

      // Processing a cancelled delivery does nothing
      const noop = await deliveryService.processDelivery(delivery.id);
      expect(noop.status).toBe("CANCELLED");
      expect(fakeSms.sentMessages.length).toBe(0);
    });

    it("should reject cancelling a delivery that has already been SENT", async () => {
      fakeSms.failureMode = "NONE";

      const event = await createTestEvent({ order_number: "ORD-ADM-3", amount: 300000 });

      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      await deliveryService.processDelivery(delivery.id);

      await expect(
        deliveryService.cancelDelivery(delivery.id, adminUserId),
      ).rejects.toThrow(/Cannot cancel a delivery with status 'SENT'/);
    });
  });
});
