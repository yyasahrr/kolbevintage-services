/**
 * Legacy Messaging Cutover Adapter & Supplier UI Message Classification
 *
 * Provides a canonical bridge for legacy frontend components:
 * - MessagingAutomationCenter.tsx
 * - NotificationPreferences.tsx
 * - Supplier Portal "Messages" UI tab
 *
 * Architectural Invariant:
 * 1. SUPPORT_CONVERSATION: Human customer/supplier inquiry or case discussion -> Handled by Support Module (Phase 5.2).
 * 2. SYSTEM_NOTIFICATION: Automated transactional/security/operational outbox notification -> Handled by Notifications Module (Phase 5.3).
 * 3. DIRECT_PEER_CHAT: Direct buyer-to-supplier unregulated chat -> Explicitly prohibited / deferred (anti-disintermediation invariant).
 */

import { Injectable } from "@nestjs/common";
import {
  type NotificationCategory,
  type NotificationChannel,
  type NotificationEventKey,
} from "@kolbe/database";

export type MessageClassification =
  | "SUPPORT_CONVERSATION"
  | "SYSTEM_NOTIFICATION"
  | "DIRECT_PEER_CHAT_PROHIBITED";

export interface LegacyAutomationTriggerMapping {
  legacyTriggerId: string;
  legacyTitle: string;
  targetEventKey: NotificationEventKey;
  defaultChannel: NotificationChannel;
  category: NotificationCategory;
  classification: MessageClassification;
  notes: string;
}

export const LEGACY_AUTOMATION_MAPPINGS: Record<string, LegacyAutomationTriggerMapping> = {
  order_confirmation: {
    legacyTriggerId: "order_confirmation",
    legacyTitle: "پیامک و ایمیل تأیید سفارش",
    targetEventKey: "ORDER_CONFIRMED",
    defaultChannel: "SMS",
    category: "TRANSACTIONAL",
    classification: "SYSTEM_NOTIFICATION",
    notes: "Converted to versioned immutable template with safe variables",
  },
  shipment_tracking: {
    legacyTriggerId: "shipment_tracking",
    legacyTitle: "اطلاع‌رسانی ارسال کالا با کد رهگیری",
    targetEventKey: "SHIPMENT_SHIPPED",
    defaultChannel: "SMS",
    category: "TRANSACTIONAL",
    classification: "SYSTEM_NOTIFICATION",
    notes: "Includes tracking_code variable with provider dispatch",
  },
  wholesale_plan_activated: {
    legacyTriggerId: "wholesale_plan_activated",
    legacyTitle: "فعال‌سازی پلن عمده‌فروشی VIP",
    targetEventKey: "VIP_MEMBERSHIP_ACTIVATED",
    defaultChannel: "IN_APP",
    category: "TRANSACTIONAL",
    classification: "SYSTEM_NOTIFICATION",
    notes: "Direct in-app notification to buyer account",
  },
  supplier_payout_ready: {
    legacyTriggerId: "supplier_payout_ready",
    legacyTitle: "اعلان واریز تسویه‌حساب تأمین‌کننده",
    targetEventKey: "PAYOUT_SUBMITTED",
    defaultChannel: "SMS",
    category: "TRANSACTIONAL",
    classification: "SYSTEM_NOTIFICATION",
    notes: "Triggered on financial settlement finalization",
  },
  support_ticket_update: {
    legacyTriggerId: "support_ticket_update",
    legacyTitle: "پیام جدید پشتیبانی",
    targetEventKey: "SUPPORT_CASE_REPLIED",
    defaultChannel: "IN_APP",
    category: "TRANSACTIONAL",
    classification: "SUPPORT_CONVERSATION",
    notes: "Human inquiry response handled by Support Module (Phase 5.2)",
  },
};

@Injectable()
export class LegacyMessagingAdapter {
  /**
   * Classify message stream for UI routing.
   */
  public classifyMessage(type: "ticket" | "notification" | "chat"): {
    classification: MessageClassification;
    moduleOwner: "support" | "notifications" | "none";
    allowed: boolean;
    reason: string;
  } {
    if (type === "ticket") {
      return {
        classification: "SUPPORT_CONVERSATION",
        moduleOwner: "support",
        allowed: true,
        reason: "Human support case managed by Phase 5.2 Support Module",
      };
    }

    if (type === "notification") {
      return {
        classification: "SYSTEM_NOTIFICATION",
        moduleOwner: "notifications",
        allowed: true,
        reason: "Authoritative system notification managed by Phase 5.3 Notifications Module",
      };
    }

    return {
      classification: "DIRECT_PEER_CHAT_PROHIBITED",
      moduleOwner: "none",
      allowed: false,
      reason: "Direct buyer-supplier chat is disallowed to prevent off-platform disintermediation (anti-disintermediation invariant)",
    };
  }

  /**
   * Get canonical mapping for legacy automation triggers.
   */
  public getMappingForLegacyTrigger(triggerId: string): LegacyAutomationTriggerMapping | null {
    return LEGACY_AUTOMATION_MAPPINGS[triggerId] ?? null;
  }

  /**
   * List all cutover mappings.
   */
  public listAllMappings(): LegacyAutomationTriggerMapping[] {
    return Object.values(LEGACY_AUTOMATION_MAPPINGS);
  }
}
