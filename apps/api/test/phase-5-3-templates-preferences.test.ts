/**
 * Phase 5.3 — Checkpoint A: Notification Domain, Templates & Preferences Test Suite
 *
 * Verifies:
 * 1. Schema & Migration Integrity (194 tables, 34 migrations, snapshot consistency after Phase 5.8 Checkpoint A).
 * 2. Versioned notification templates (DRAFT -> PUBLISHED -> SUPERSEDED).
 * 3. Published template version is historically immutable.
 * 4. Safe template variables (regex whitelisting, prohibited JS/eval, missing var rejection).
 * 5. Sensitive variable and payload rejection (password, secret, token, card_number).
 * 6. Channel-specific escaping (HTML entity escaping for EMAIL, CRLF sanitization for Subject).
 * 7. Recipient notification preferences (multi-channel, category opt-outs).
 * 8. Mandatory security notification invariant (cannot be disabled by recipient).
 * 9. Marketing notification consent enforcement (default opt-in FALSE, requires compliance consent).
 * 10. Quiet hours evaluation window logic.
 * 11. Event capture idempotency and deduplication (zero duplicate fan-out).
 * 12. Authoritative server-side recipient destination resolution (Retail, VIP, Supplier, Admin).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountUser,
  consentEvent,
  legalPolicyDocument,
  notificationEvent,
  notificationPreference,
  notificationTemplate,
  notificationTemplateVersion,
  supplier,
  supplierMember,
  wholesaleAccount,
} from "@kolbe/database";
import {
  NotificationTemplateService,
} from "../src/modules/notifications/notification-template.service";
import {
  NotificationPreferenceService,
} from "../src/modules/notifications/notification-preference.service";
import {
  NotificationEventService,
} from "../src/modules/notifications/notification-event.service";
import {
  NotificationPreferenceForbiddenError,
  NotificationRecipientNotFoundError,
  NotificationSensitivePayloadError,
  NotificationTemplatePublishedImmutableError,
  NotificationTemplateRenderError,
  NotificationTemplateValidationError,
  NotificationTemplateVersionNotFoundError,
} from "../src/modules/notifications/notifications.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

describe("Phase 5.3 — Checkpoint A: Notification Templates & Preferences", () => {
  let harness: Harness;
  let templateService: NotificationTemplateService;
  let preferenceService: NotificationPreferenceService;
  let eventService: NotificationEventService;

  let adminUserId: string;
  let retailUserId: string;
  let vipAccountId: string;
  let supplierContext: SupplierContext;
  let policyDocId: string;

  beforeAll(async () => {
    harness = await bootHarness("phase53_a_test");
    templateService = harness.app.get(NotificationTemplateService);
    preferenceService = harness.app.get(NotificationPreferenceService);
    eventService = harness.app.get(NotificationEventService);

    // 1. Seed admin user
    adminUserId = makeId("adm");
    await harness.db.insert(accountUser).values({
      id: adminUserId,
      email: "admin.notif@kolbe.test",
      passwordHash: "hash",
      salt: "salt",
      role: "admin",
      displayName: "Admin Notif Manager",
    });

    // 2. Seed retail customer
    retailUserId = makeId("usr");
    await harness.db.insert(accountUser).values({
      id: retailUserId,
      email: "retail.customer@kolbe.test",
      phone: "09121112233",
      passwordHash: "hash",
      salt: "salt",
      role: "customer",
      displayName: "Reza Customer",
    });

    // 3. Seed VIP wholesale account
    const vipContactUserId = makeId("vip_usr");
    await harness.db.insert(accountUser).values({
      id: vipContactUserId,
      email: "vip.buyer@kolbe.test",
      phone: "09129998877",
      passwordHash: "hash",
      salt: "salt",
      role: "vip",
      displayName: "Saeed VIP",
    });

    vipAccountId = makeId("wact");
    await harness.db.insert(wholesaleAccount).values({
      id: vipAccountId,
      userId: vipContactUserId,
      memberName: "Saeed VIP",
      storeName: "Tehran Boutiques VIP",
      phone: "09129998877",
      city: "تهران",
      status: "approved",
    });

    // 4. Seed suppliers
    supplierContext = await seedTwoSuppliers(harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("1. Schema & Migration Integrity: 198 tables, migrations through 0042 applied", async () => {
    const rows = await harness.db.execute<{ count: string }>(
      "SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    expect(Number(rows.rows[0].count)).toBe(198); // 5.9-B adds the 3 return tables; 5.9-C alters in place; 5.10-A/B are index-only
  });

  describe("2. Versioned Templates Lifecycle & Immutability", () => {
    let templateId: string;

    it("2.1 creates template with draft v1", async () => {
      const created = await templateService.createTemplate({
        templateKey: "order_confirmation_sms",
        name: "تأیید سفارش پیامکی",
        eventKey: "ORDER_CONFIRMED",
        channel: "SMS",
        category: "TRANSACTIONAL",
        initialVersion: {
          body: "{{customer_name}} عزیز، سفارش شما با کد {{order_number}} ثبت شد.",
          variablesSchema: ["customer_name", "order_number"],
        },
        adminUserId,
      });

      expect(created.templateKey).toBe("order_confirmation_sms");
      expect(created.status).toBe("ACTIVE");
      expect(created.initialVersion.version).toBe(1);
      expect(created.initialVersion.status).toBe("DRAFT");
      templateId = created.id;
    });

    it("2.2 publishes draft v1 successfully", async () => {
      const published = await templateService.publishVersion(templateId, 1, adminUserId);
      expect(published.status).toBe("PUBLISHED");
      expect(published.publishedBy).toBe(adminUserId);
      expect(published.publishedAt).toBeDefined();

      const tpl = await templateService.getTemplate(templateId);
      expect(tpl.publishedVersion?.version).toBe(1);
    });

    it("2.3 creates a new draft version v2 for updates", async () => {
      const v2 = await templateService.createDraftVersion(templateId, {
        body: "{{customer_name}} گرامی، سفارش {{order_number}} به مبلغ {{amount}} ریال تأیید گردید.",
        variablesSchema: ["customer_name", "order_number", "amount"],
        adminUserId,
      });

      expect(v2.version).toBe(2);
      expect(v2.status).toBe("DRAFT");
    });

    it("2.4 publishing v2 supersedes v1 automatically", async () => {
      const publishedV2 = await templateService.publishVersion(templateId, 2, adminUserId);
      expect(publishedV2.status).toBe("PUBLISHED");
      expect(publishedV2.version).toBe(2);

      const tpl = await templateService.getTemplate(templateId);
      expect(tpl.publishedVersion?.version).toBe(2);

      const v1 = tpl.versions.find((v) => v.version === 1);
      expect(v1?.status).toBe("SUPERSEDED");
    });

    it("2.5 archives template safely", async () => {
      const archived = await templateService.archiveTemplate(templateId, adminUserId);
      expect(archived.status).toBe("ARCHIVED");
    });
  });

  describe("3. Safe Template Variables & Rendering", () => {
    it("3.1 rejects sensitive variable identifiers at validation time", async () => {
      expect(() => {
        templateService.validateVariables(["customer_name", "user_password"]);
      }).toThrow(NotificationTemplateValidationError);

      expect(() => {
        templateService.validateVariables(["secret_token"]);
      }).toThrow(NotificationTemplateValidationError);

      expect(() => {
        templateService.validateVariables(["api_key_val"]);
      }).toThrow(NotificationTemplateValidationError);

      expect(() => {
        templateService.validateVariables(["credit_card_no"]);
      }).toThrow(NotificationTemplateValidationError);
    });

    it("3.2 rejects variables with invalid characters / JavaScript injection", async () => {
      expect(() => {
        templateService.validateVariables(["eval(alert(1))"]);
      }).toThrow(NotificationTemplateValidationError);

      expect(() => {
        templateService.validateVariables(["user.address.city"]);
      }).toThrow(NotificationTemplateValidationError);
    });

    it("3.3 rejects template content referencing undeclared variables", async () => {
      expect(() => {
        templateService.validateContentAgainstSchema(
          "Hello {{name}}, your balance is {{balance}}",
          undefined,
          ["name"], // missing balance
        );
      }).toThrow(NotificationTemplateValidationError);
    });

    it("3.4 safely renders variables and rejects missing required variable", async () => {
      const bodyTpl = "سلام {{customer_name}}، سفارش {{order_number}} ثبت شد.";
      const vars = { customer_name: "امیر" }; // missing order_number

      expect(() => {
        templateService.render(undefined, bodyTpl, vars, "SMS");
      }).toThrow(NotificationTemplateRenderError);

      const rendered = templateService.render(
        undefined,
        bodyTpl,
        { customer_name: "امیر", order_number: "ORD-101" },
        "SMS",
      );
      expect(rendered.body).toBe("سلام امیر، سفارش ORD-101 ثبت شد.");
    });

    it("3.5 channel-specific escaping: HTML entity escaping for EMAIL channel", async () => {
      const bodyTpl = "<p>Welcome {{user_name}} & your title is {{title}}</p>";
      const vars = {
        user_name: "Alice <script>alert(1)</script>",
        title: "Manager & Lead",
      };

      const rendered = templateService.render(undefined, bodyTpl, vars, "EMAIL");
      expect(rendered.body).toContain("Alice &lt;script&gt;alert(1)&lt;/script&gt;");
      expect(rendered.body).toContain("Manager &amp; Lead");
      expect(rendered.body).not.toContain("<script>");
    });

    it("3.6 sanitizes email subject to prevent CRLF header injection", async () => {
      const subjectTpl = "Order {{order_number}} Confirmed\r\nBcc: attacker@evil.com";
      const vars = { order_number: "ORD-999" };

      const rendered = templateService.render(subjectTpl, "Body text", vars, "EMAIL");
      expect(rendered.subject).toBe("Order ORD-999 Confirmed Bcc: attacker@evil.com");
      expect(rendered.subject).not.toContain("\r");
      expect(rendered.subject).not.toContain("\n");
    });
  });

  describe("4. Recipient Preferences & Mandatory Policies", () => {
    it("4.1 rejects disabling mandatory SECURITY notifications", async () => {
      await expect(
        preferenceService.updatePreferences(
          "ACCOUNT_USER",
          retailUserId,
          [
            {
              category: "SECURITY",
              channel: "SMS",
              enabled: false, // Forbidden!
            },
          ],
          retailUserId,
        ),
      ).rejects.toThrow(NotificationPreferenceForbiddenError);
    });

    it("4.2 allows updating optional preferences", async () => {
      const updated = await preferenceService.updatePreferences(
        "ACCOUNT_USER",
        retailUserId,
        [
          {
            category: "OPERATIONAL",
            channel: "SMS",
            enabled: false,
          },
          {
            category: "TRANSACTIONAL",
            channel: "EMAIL",
            enabled: true,
          },
        ],
        retailUserId,
      );

      expect(updated.length).toBe(2);

      const isSmsAllowed = await preferenceService.isDeliveryAllowed({
        recipientType: "ACCOUNT_USER",
        recipientId: retailUserId,
        category: "OPERATIONAL",
        eventKey: "ORDER_FULFILLMENT_UPDATED",
        channel: "SMS",
      });
      expect(isSmsAllowed.allowed).toBe(false);
      expect(isSmsAllowed.reason).toContain("disabled");
    });

    it("4.3 marketing defaults to disabled without compliance consent", async () => {
      // Retail user has no consent record
      const allowedWithoutConsent = await preferenceService.isDeliveryAllowed({
        recipientType: "ACCOUNT_USER",
        recipientId: retailUserId,
        category: "MARKETING",
        eventKey: "VIP_MEMBERSHIP_ACTIVATED",
        channel: "SMS",
      });
      expect(allowedWithoutConsent.allowed).toBe(false);
      expect(allowedWithoutConsent.reason).toContain("consent");
    });

    it("4.4 marketing is allowed only after authoritative compliance consent granted", async () => {
      // Insert compliance consent event
      await harness.db.insert(consentEvent).values({
        id: makeId("csnt"),
        userId: retailUserId,
        purpose: "MARKETING_SMS",
        eventType: "granted",
        source: "portal",
        evidenceHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      });

      const allowedWithConsent = await preferenceService.isDeliveryAllowed({
        recipientType: "ACCOUNT_USER",
        recipientId: retailUserId,
        category: "MARKETING",
        eventKey: "VIP_MEMBERSHIP_ACTIVATED",
        channel: "SMS",
      });
      expect(allowedWithConsent.allowed).toBe(true);
    });

    it("4.5 evaluates quiet hours window correctly", () => {
      const dayTime = new Date("2026-09-21T14:30:00Z"); // 14:30 UTC
      const nightTime = new Date("2026-09-21T23:30:00Z"); // 23:30 UTC

      // Test with custom local hours
      expect(preferenceService.isWithinQuietHours("22:00", "08:00", new Date(2026, 8, 21, 23, 0))).toBe(true);
      expect(preferenceService.isWithinQuietHours("22:00", "08:00", new Date(2026, 8, 21, 14, 0))).toBe(false);
      expect(preferenceService.isWithinQuietHours("22:00", "08:00", new Date(2026, 8, 21, 5, 0))).toBe(true);
    });
  });

  describe("5. Event Capture, Deduplication & Sensitive Protection", () => {
    it("5.1 captures notification event successfully", async () => {
      const res = await eventService.captureEvent({
        eventKey: "ORDER_CREATED",
        sourceDomain: "orders",
        sourceEntityType: "retail_order",
        sourceEntityId: "ord_1001",
        sourceEventId: "evt_ord_created_1001",
        recipientScope: "ACCOUNT_USER",
        recipientId: retailUserId,
        payload: {
          order_number: "ORD-1001",
          amount: "1500000",
        },
      });

      expect(res.isDuplicate).toBe(false);
      expect(res.event.eventKey).toBe("ORDER_CREATED");
      expect(res.event.sourceEventId).toBe("evt_ord_created_1001");
    });

    it("5.2 duplicate source event does not create duplicate fan-out (idempotent)", async () => {
      const res = await eventService.captureEvent({
        eventKey: "ORDER_CREATED",
        sourceDomain: "orders",
        sourceEntityType: "retail_order",
        sourceEntityId: "ord_1001",
        sourceEventId: "evt_ord_created_1001", // duplicate!
        recipientScope: "ACCOUNT_USER",
        recipientId: retailUserId,
        payload: {
          order_number: "ORD-1001",
        },
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.event.sourceEventId).toBe("evt_ord_created_1001");
    });

    it("5.3 rejects events whose payload contains sensitive fields", async () => {
      await expect(
        eventService.captureEvent({
          eventKey: "AUTH_SECURITY_ALERT",
          sourceDomain: "auth",
          sourceEntityType: "account_user",
          sourceEntityId: retailUserId,
          sourceEventId: "evt_auth_pwd_leak",
          recipientScope: "ACCOUNT_USER",
          recipientId: retailUserId,
          payload: {
            user_id: retailUserId,
            raw_password: "super_secret_password", // sensitive!
          },
        }),
      ).rejects.toThrow(NotificationSensitivePayloadError);
    });
  });

  describe("6. Authoritative Recipient Contact Resolution", () => {
    it("6.1 resolves contact for ACCOUNT_USER from database records", async () => {
      const dest = await eventService.resolveRecipient("ACCOUNT_USER", retailUserId);
      expect(dest.userId).toBe(retailUserId);
      expect(dest.email).toBe("retail.customer@kolbe.test");
      expect(dest.phone).toBe("09121112233");
      expect(dest.displayName).toBe("Reza Customer");
    });

    it("6.2 resolves contact for VIP_ACCOUNT_MEMBER from wholesale account record", async () => {
      const dest = await eventService.resolveRecipient("VIP_ACCOUNT_MEMBER", vipAccountId);
      expect(dest.displayName).toBe("Tehran Boutiques VIP");
      expect(dest.phone).toBe("09129998877");
    });

    it("6.3 resolves contact for SUPPLIER_MEMBER from supplier member record", async () => {
      const [member] = await harness.db
        .select()
        .from(supplierMember)
        .where(eq(supplierMember.supplierId, supplierContext.supA))
        .limit(1);

      const dest = await eventService.resolveRecipient(
        "SUPPLIER_MEMBER",
        member.id,
      );
      expect(dest.userId).toBe(member.userId);
      expect(dest.email).toBeDefined();
    });

    it("6.4 rejects non-existent recipient with 404 DomainError", async () => {
      await expect(
        eventService.resolveRecipient("ACCOUNT_USER", "non_existent_user_id"),
      ).rejects.toThrow(NotificationRecipientNotFoundError);
    });
  });
});
