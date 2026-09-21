import type {
  SupportCaseStatus,
  SupportPriority,
  SupportCategory,
  SupportRequesterType,
  SupportAuthorType,
} from "@kolbe/database";

export interface LegacyWholesaleTicket {
  id: string;
  orderCode?: string;
  type: "inquiry" | "problem" | "change" | "cancel" | "invoice" | string;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed" | string;
  priority: "low" | "medium" | "high" | "urgent" | string;
  createdAt: string;
  updatedAt?: string;
  messages?: Array<{
    id: string;
    sender: "buyer" | "admin" | string;
    text: string;
    timestamp: string;
    attachments?: string[];
  }>;
}

export interface LegacySupplierDispute {
  id: string;
  supplierId: string;
  orderId?: string;
  reason: string;
  status: "pending" | "under_review" | "settled" | "rejected" | string;
  createdAt: string;
}

export class LegacyCutoverAdapter {
  /**
   * Maps legacy wholesale ticket status to canonical backend SupportCaseStatus.
   */
  static mapStatus(legacyStatus: string): SupportCaseStatus {
    const s = legacyStatus.toLowerCase();
    switch (s) {
      case "open":
      case "pending":
        return "OPEN";
      case "in_progress":
      case "under_review":
        return "IN_PROGRESS";
      case "resolved":
      case "settled":
        return "RESOLVED";
      case "closed":
      case "rejected":
        return "CLOSED";
      default:
        return "OPEN";
    }
  }

  /**
   * Maps legacy priority to canonical backend SupportPriority.
   */
  static mapPriority(legacyPriority: string): SupportPriority {
    const p = legacyPriority.toLowerCase();
    switch (p) {
      case "low":
        return "LOW";
      case "medium":
      case "normal":
        return "NORMAL";
      case "high":
        return "HIGH";
      case "urgent":
        return "URGENT";
      default:
        return "NORMAL";
    }
  }

  /**
   * Maps legacy wholesale ticket type to canonical backend SupportCategory.
   */
  static mapCategory(legacyType: string): SupportCategory {
    const t = legacyType.toLowerCase();
    switch (t) {
      case "inquiry":
      case "question":
        return "WHOLESALE";
      case "problem":
      case "defect":
        return "QUALITY";
      case "change":
      case "order":
        return "ORDER";
      case "cancel":
        return "ORDER";
      case "invoice":
      case "billing":
        return "FINANCE";
      default:
        return "WHOLESALE";
    }
  }

  /**
   * Translates a legacy wholesale ticket payload into backend support case creation input.
   */
  static adaptWholesaleTicket(
    ticket: LegacyWholesaleTicket,
    wholesaleAccountId: string,
    buyerUserId: string,
  ) {
    return {
      requesterType: "VIP_BUYER" as SupportRequesterType,
      requesterUserId: buyerUserId,
      wholesaleAccountId,
      category: this.mapCategory(ticket.type),
      subject: ticket.subject,
      priority: this.mapPriority(ticket.priority),
      source: "VIP_PORTAL" as const,
      initialMessage: ticket.description,
      relations: ticket.orderCode
        ? [
            {
              relationType: "ORDER" as const,
              targetId: ticket.orderCode,
            },
          ]
        : undefined,
    };
  }

  /**
   * Translates legacy messages to backend support message input format.
   */
  static adaptWholesaleMessages(
    caseId: string,
    legacyMessages: LegacyWholesaleTicket["messages"],
  ) {
    if (!legacyMessages || legacyMessages.length === 0) return [];

    return legacyMessages.map((m) => ({
      caseId,
      author: {
        type: (m.sender === "admin" ? "ADMIN" : "VIP_BUYER") as SupportAuthorType,
        displayName: m.sender === "admin" ? "پشتیبانی کلبه" : "خریدار عمده",
      },
      body: m.text,
      visibility: "PUBLIC" as const,
      idempotencyKey: `legacy_cutover_${m.id}`,
    }));
  }

  /**
   * Translates legacy supplier dispute into backend support case creation input.
   */
  static adaptSupplierDispute(dispute: LegacySupplierDispute, supplierUserId?: string) {
    return {
      requesterType: "SUPPLIER" as SupportRequesterType,
      requesterUserId: supplierUserId ?? null,
      supplierId: dispute.supplierId,
      category: "SETTLEMENT" as SupportCategory,
      subject: `اعتراض تأمین‌کننده — ${dispute.id}`,
      priority: "HIGH" as SupportPriority,
      source: "SUPPLIER_PORTAL" as const,
      initialMessage: dispute.reason,
      relations: dispute.orderId
        ? [
            {
              relationType: "ORDER" as const,
              targetId: dispute.orderId,
            },
          ]
        : undefined,
    };
  }
}
