/**
 * Phase 5.3 — Checkpoint C: Provider Abstraction, Receipts & Channel Safety Test Suite
 *
 * Verifies:
 * 1. Iranian mobile number normalization (Persian/Arabic numerals, +98, 0098, 98, 9XXXXXXXXX).
 * 2. Invalid mobile number rejection.
 * 3. SMS parts calculation (Persian UCS-2 70/67 vs GSM-7 160/153).
 * 4. Email header sanitization and CRLF injection prevention.
 * 5. Production fail-closed enforcement (fake provider refuses execution in production).
 * 6. Provider webhook receipt signature verification (HMAC SHA-256).
 * 7. Delivery receipt state transition: SENT -> DELIVERED on provider success evidence.
 * 8. Permanent bounce handling: SENT -> FAILED_PERMANENT (HARD_BOUNCE).
 * 9. Receipt idempotency and duplicate webhook ingestion suppression.
 * 10. Uncorrelated receipt handling (recorded as IGNORED).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import {
  accountUser,
  notificationDelivery,
  notificationProviderEvent,
} from "@kolbe/database";
import {
  NotificationTemplateService,
} from "../src/modules/notifications/notification-template.service";
import {
  NotificationEventService,
} from "../src/modules/notifications/notification-event.service";
import {
  NotificationDeliveryService,
} from "../src/modules/notifications/notification-delivery.service";
import {
  NotificationReceiptService,
} from "../src/modules/notifications/notification-receipt.service";
import {
  FakeEmailProvider,
  FakeSmsProvider,
} from "../src/modules/notifications/providers/test-providers";
import {
  calculateSmsParts,
  convertEasternDigitsToAscii,
  normalizeIranianMobile,
  sanitizeEmailHeader,
  validateEmail,
} from "../src/modules/notifications/notification-normalization";
import {
  NotificationProviderConfigurationError,
  NotificationProviderSignatureError,
} from "../src/modules/notifications/notifications.errors";
import { bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.3 — Checkpoint C: Provider Abstraction, Receipts & Channel Safety", () => {
  let harness: Harness;
  let templateService: NotificationTemplateService;
  let eventService: NotificationEventService;
  let deliveryService: NotificationDeliveryService;
  let receiptService: NotificationReceiptService;
  let fakeSms: FakeSmsProvider;
  let fakeEmail: FakeEmailProvider;

  const testUserId = `user_ckc_${crypto.randomUUID().slice(0, 8)}`;
  const adminUserId = `admin_ckc_${crypto.randomUUID().slice(0, 8)}`;
  const testPhone = "09125556677";
  const testEmail = "buyer.ckc@example.com";

  beforeAll(async () => {
    harness = await bootHarness("phase53_c_test");
    templateService = harness.app.get(NotificationTemplateService);
    eventService = harness.app.get(NotificationEventService);
    deliveryService = harness.app.get(NotificationDeliveryService);
    receiptService = harness.app.get(NotificationReceiptService);
    fakeSms = harness.app.get(FakeSmsProvider);
    fakeEmail = harness.app.get(FakeEmailProvider);

    await harness.db.insert(accountUser).values({
      id: adminUserId,
      email: "admin.ckc@example.com",
      phone: "09120000001",
      passwordHash: "hash",
      salt: "salt",
      fullName: "مدیر تستی درگاه‌ها",
      role: "admin",
    });

    await harness.db.insert(accountUser).values({
      id: testUserId,
      email: testEmail,
      phone: testPhone,
      passwordHash: "hash",
      salt: "salt",
      fullName: "مشتری آزمون درگاه",
      role: "customer",
    });

    const smsTpl = await templateService.createTemplate({
      templateKey: "shipment_shipped_sms",
      name: "اعلان ارسال بسته پیامکی",
      eventKey: "SHIPMENT_SHIPPED",
      channel: "SMS",
      category: "TRANSACTIONAL",
      initialVersion: {
        body: "بسته سفارش {{order_number}} با کد رهگیری {{tracking_code}} ارسال شد.",
        variablesSchema: ["order_number", "tracking_code"],
      },
      adminUserId,
    });
    await templateService.publishVersion(smsTpl.id, 1, adminUserId);

    const emailTpl = await templateService.createTemplate({
      templateKey: "shipment_shipped_email",
      name: "اعلان ارسال بسته ایمیلی",
      eventKey: "SHIPMENT_SHIPPED",
      channel: "EMAIL",
      category: "TRANSACTIONAL",
      initialVersion: {
        subject: "بسته شما ارسال شد: {{order_number}}",
        body: "<p>کد رهگیری: {{tracking_code}}</p>",
        variablesSchema: ["order_number", "tracking_code"],
      },
      adminUserId,
    });
    await templateService.publishVersion(emailTpl.id, 1, adminUserId);
  });

  beforeEach(() => {
    fakeSms.clear();
    fakeEmail.clear();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createShipmentEvent(trackingCode: string, orderNumber: string) {
    const res = await eventService.captureEvent({
      eventKey: "SHIPMENT_SHIPPED",
      sourceDomain: "shipping",
      sourceEntityType: "shipment",
      sourceEntityId: `shp_${crypto.randomUUID().slice(0, 8)}`,
      sourceEventId: `ev_shp_${crypto.randomUUID()}`,
      recipientScope: "ACCOUNT_USER",
      payload: {
        tracking_code: trackingCode,
        order_number: orderNumber,
      },
    });
    return res.event;
  }

  // --------------------------------------------------------------------------
  // C.1 — Iranian Mobile Number Normalization & Channel Safety
  // --------------------------------------------------------------------------
  describe("C.1 — Iranian Mobile Number Normalization & Channel Safety", () => {
    it("should normalize eastern numerals to ASCII digits", () => {
      expect(convertEasternDigitsToAscii("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
      expect(convertEasternDigitsToAscii("٠٩١٢٣٤٥٦٧٨٩")).toBe("09123456789");
    });

    it("should normalize valid Iranian mobile phone numbers across prefix formats", () => {
      expect(normalizeIranianMobile("+989123456789")).toEqual({ valid: true, normalized: "09123456789" });
      expect(normalizeIranianMobile("00989123456789")).toEqual({ valid: true, normalized: "09123456789" });
      expect(normalizeIranianMobile("989123456789")).toEqual({ valid: true, normalized: "09123456789" });
      expect(normalizeIranianMobile("9123456789")).toEqual({ valid: true, normalized: "09123456789" });
      expect(normalizeIranianMobile("09123456789")).toEqual({ valid: true, normalized: "09123456789" });
      expect(normalizeIranianMobile(" ۰۹۱۲-۳۴۵-۶۷۸۹ ")).toEqual({ valid: true, normalized: "09123456789" });
    });

    it("should reject invalid, landline, or foreign phone numbers", () => {
      expect(normalizeIranianMobile("02188888888").valid).toBe(false); // Tehran landline
      expect(normalizeIranianMobile("12345").valid).toBe(false); // short
      expect(normalizeIranianMobile("+14155552671").valid).toBe(false); // US number
      expect(normalizeIranianMobile("").valid).toBe(false);
    });

    it("should correctly compute SMS parts for Persian UCS-2 and English GSM-7", () => {
      // Persian (UCS-2): single part <= 70 chars
      const p70 = "سلام مشتری گرامی، این یک پیام کوتاه آزمایشی جهت بررسی سقف پیام است. تشکر";
      const calcP1 = calculateSmsParts(p70.slice(0, 70));
      expect(calcP1.isPersian).toBe(true);
      expect(calcP1.parts).toBe(1);

      // Persian > 70 chars splits into 67 chars per part
      const p75 = p70.slice(0, 75);
      const calcP2 = calculateSmsParts(p75);
      expect(calcP2.parts).toBe(2);

      // English GSM-7: single part <= 160 chars
      const eng160 = "a".repeat(160);
      const calcE1 = calculateSmsParts(eng160);
      expect(calcE1.isPersian).toBe(false);
      expect(calcE1.parts).toBe(1);

      const eng161 = "a".repeat(161);
      const calcE2 = calculateSmsParts(eng161);
      expect(calcE2.parts).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // C.2 — Email Header Safety & CRLF Injection Prevention
  // --------------------------------------------------------------------------
  describe("C.2 — Email Header Safety & CRLF Injection Prevention", () => {
    it("should strip CRLF characters and collapse spaces in email headers", () => {
      const maliciousSubject = "Important Notice\r\nBcc: hacker@example.com\r\nSubject: Spoofed";
      const sanitized = sanitizeEmailHeader(maliciousSubject);
      expect(sanitized).not.toContain("\r");
      expect(sanitized).not.toContain("\n");
      expect(sanitized).toBe("Important Notice Bcc: hacker@example.com Subject: Spoofed");
    });

    it("should validate well-formed email addresses and reject CRLF injection", () => {
      expect(validateEmail("user@example.com")).toBe(true);
      expect(validateEmail("user.name+tag@sub.domain.co")).toBe(true);
      expect(validateEmail("user@example.com\r\nCc: victim@example.com")).toBe(false);
      expect(validateEmail("invalid-email")).toBe(false);
      expect(validateEmail("")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // C.3 — Production Fail-Closed Safety
  // --------------------------------------------------------------------------
  describe("C.3 — Production Fail-Closed Safety", () => {
    it("should fail closed and throw error if fake provider is invoked in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";

        await expect(
          fakeSms.send({
            to: "09121112233",
            body: "تست محیط عملیاتی",
            idempotencyKey: "idem_prod_test",
          }),
        ).rejects.toThrow(NotificationProviderConfigurationError);

        await expect(
          fakeEmail.send({
            to: "buyer@example.com",
            subject: "تست",
            body: "متن",
            idempotencyKey: "idem_prod_email_test",
          }),
        ).rejects.toThrow(NotificationProviderConfigurationError);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  // --------------------------------------------------------------------------
  // C.4 — Webhook Delivery Receipts & Signature Verification
  // --------------------------------------------------------------------------
  describe("C.4 — Webhook Delivery Receipts & State Machine Transitions", () => {
    it("should reject delivery receipt with missing or invalid signature", async () => {
      const rawPayload = JSON.stringify({
        externalMessageId: "sms_msg_invalid_sig",
        eventType: "DELIVERED",
      });

      await expect(
        receiptService.ingestReceipt("fake_sms", rawPayload, "invalid_signature_hex"),
      ).rejects.toThrow(NotificationProviderSignatureError);
    });

    it("should accept valid signature and transition delivery from SENT to DELIVERED", async () => {
      // 1. Enqueue and dispatch SMS delivery
      const event = await createShipmentEvent("TRK-9001", "ORD-5001");
      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      const processed = await deliveryService.processDelivery(delivery.id);
      expect(processed.status).toBe("SENT");
      const externalMsgId = processed.providerMessageId!;

      // 2. Simulate provider sending DELIVERED webhook
      const webhookPayload = JSON.stringify({
        externalEventId: `evt_${crypto.randomUUID()}`,
        externalMessageId: externalMsgId,
        eventType: "DELIVERED",
        timestamp: new Date().toISOString(),
      });
      const signature = fakeSms.generateWebhookSignature(webhookPayload);

      // 3. Ingest webhook
      const receiptResult = await receiptService.ingestReceipt("fake_sms", webhookPayload, signature);
      expect(receiptResult.processingStatus).toBe("PROCESSED");
      expect(receiptResult.deliveryId).toBe(delivery.id);
      expect(receiptResult.isDuplicate).toBe(false);

      // 4. Verify delivery status updated to DELIVERED
      const updatedDelivery = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(updatedDelivery.status).toBe("DELIVERED");
      expect(updatedDelivery.deliveredAt).toBeDefined();

      // 5. Verify provider event table record
      const [evRecord] = await harness.db
        .select()
        .from(notificationProviderEvent)
        .where(eq(notificationProviderEvent.id, receiptResult.eventId));
      expect(evRecord).toBeDefined();
      expect(evRecord.signatureVerified).toBe(true);
      expect(evRecord.processingStatus).toBe("PROCESSED");
    });

    it("should handle permanent bounce webhook by transitioning delivery to FAILED_PERMANENT", async () => {
      const event = await createShipmentEvent("TRK-9002", "ORD-5002");
      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "EMAIL",
        category: "TRANSACTIONAL",
      });

      const processed = await deliveryService.processDelivery(delivery.id);
      expect(processed.status).toBe("SENT");
      const externalMsgId = processed.providerMessageId!;

      // Simulate bounce webhook
      const webhookPayload = JSON.stringify({
        externalEventId: `evt_bounce_${crypto.randomUUID()}`,
        externalMessageId: externalMsgId,
        eventType: "BOUNCED",
        reason: "550 5.1.1 User unknown / Mailbox does not exist",
        timestamp: new Date().toISOString(),
      });
      const signature = fakeEmail.generateWebhookSignature(webhookPayload);

      const receiptResult = await receiptService.ingestReceipt("fake_email", webhookPayload, signature);
      expect(receiptResult.processingStatus).toBe("PROCESSED");

      const updatedDelivery = await deliveryService.getDeliveryWithAttempts(delivery.id);
      expect(updatedDelivery.status).toBe("FAILED_PERMANENT");
      expect(updatedDelivery.failureCategory).toBe("HARD_BOUNCE");
      expect(updatedDelivery.failureDetail).toContain("User unknown");
      expect(updatedDelivery.failedAt).toBeDefined();
    });

    it("should idempotently suppress duplicate webhook deliveries", async () => {
      const event = await createShipmentEvent("TRK-9003", "ORD-5003");
      const delivery = await deliveryService.enqueueDelivery({
        eventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: testUserId,
        channel: "SMS",
        category: "TRANSACTIONAL",
      });

      const processed = await deliveryService.processDelivery(delivery.id);
      const externalMsgId = processed.providerMessageId!;
      const externalEventId = `evt_dedup_${crypto.randomUUID()}`;

      const webhookPayload = JSON.stringify({
        externalEventId,
        externalMessageId: externalMsgId,
        eventType: "DELIVERED",
      });
      const signature = fakeSms.generateWebhookSignature(webhookPayload);

      // Ingestion 1 -> PROCESSED
      const res1 = await receiptService.ingestReceipt("fake_sms", webhookPayload, signature);
      expect(res1.isDuplicate).toBe(false);
      expect(res1.processingStatus).toBe("PROCESSED");

      // Ingestion 2 with same externalEventId -> DUPLICATE
      const res2 = await receiptService.ingestReceipt("fake_sms", webhookPayload, signature);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.eventId).toBe(res1.eventId);
    });

    it("should safely ignore receipt for unknown or uncorrelated message", async () => {
      const unknownMsgId = `unknown_${crypto.randomUUID()}`;
      const webhookPayload = JSON.stringify({
        externalEventId: `evt_unk_${crypto.randomUUID()}`,
        externalMessageId: unknownMsgId,
        eventType: "DELIVERED",
      });
      const signature = fakeSms.generateWebhookSignature(webhookPayload);

      const res = await receiptService.ingestReceipt("fake_sms", webhookPayload, signature);
      expect(res.processingStatus).toBe("IGNORED");
      expect(res.deliveryId).toBeNull();

      const [stored] = await harness.db
        .select()
        .from(notificationProviderEvent)
        .where(eq(notificationProviderEvent.id, res.eventId));
      expect(stored.processingStatus).toBe("IGNORED");
      expect(stored.errorMessage).toContain("No delivery found");
    });
  });
});
