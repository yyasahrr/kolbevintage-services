import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import {
  accountUser,
  notificationEvent,
  supplier,
  supplierMember,
  wholesaleAccount,
  type NotificationEventKey,
  type NotificationRecipientType,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  NotificationRecipientNotFoundError,
  NotificationSensitivePayloadError,
} from "./notifications.errors";
import crypto from "node:crypto";

const SENSITIVE_PAYLOAD_KEYS = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "card_number",
  "cvv",
  "credit_card",
  "pin",
  "private_key",
  "authorization",
];

export interface CaptureEventInput {
  eventKey: NotificationEventKey;
  sourceDomain: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceEventId: string;
  occurredAt?: Date;
  recipientScope: NotificationRecipientType;
  recipientId: string;
  payload: Record<string, unknown>;
}

export interface RecipientDestination {
  recipientType: NotificationRecipientType;
  recipientId: string;
  userId?: string;
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
}

@Injectable()
export class NotificationEventService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    private readonly audit: AuditService,
  ) {}

  /**
   * Scan payload for prohibited sensitive values.
   */
  public sanitizeAndValidatePayload(payload: Record<string, unknown>): Record<string, unknown> {
    for (const key of Object.keys(payload)) {
      const lower = key.toLowerCase();
      for (const sensitive of SENSITIVE_PAYLOAD_KEYS) {
        if (lower.includes(sensitive)) {
          throw new NotificationSensitivePayloadError(key);
        }
      }
    }
    return payload;
  }

  /**
   * Capture and persist an authoritative notification event with deduplication.
   */
  public async captureEvent(input: CaptureEventInput): Promise<{
    event: typeof notificationEvent.$inferSelect;
    isDuplicate: boolean;
  }> {
    this.sanitizeAndValidatePayload(input.payload);

    // Check for duplicate source event (idempotency)
    const [existing] = await this.db
      .select()
      .from(notificationEvent)
      .where(
        and(
          eq(notificationEvent.sourceDomain, input.sourceDomain),
          eq(notificationEvent.sourceEventId, input.sourceEventId),
        ),
      )
      .limit(1);

    if (existing) {
      return { event: existing, isDuplicate: true };
    }

    const eventId = `nevt_${crypto.randomUUID()}`;
    const [created] = await this.db
      .insert(notificationEvent)
      .values({
        id: eventId,
        eventKey: input.eventKey,
        sourceDomain: input.sourceDomain,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        sourceEventId: input.sourceEventId,
        occurredAt: input.occurredAt ?? new Date(),
        recipientScope: input.recipientScope,
        payload: input.payload,
      })
      .returning();

    return { event: created, isDuplicate: false };
  }

  /**
   * Resolve authoritative contact destination from server-side records.
   * Client-supplied destination contacts are NEVER trusted.
   */
  public async resolveRecipient(
    recipientType: NotificationRecipientType,
    recipientId: string,
  ): Promise<RecipientDestination> {
    switch (recipientType) {
      case "ACCOUNT_USER":
      case "ADMIN_USER": {
        const [user] = await this.db
          .select()
          .from(accountUser)
          .where(eq(accountUser.id, recipientId))
          .limit(1);

        if (!user) {
          throw new NotificationRecipientNotFoundError(recipientType, recipientId);
        }

        return {
          recipientType,
          recipientId,
          userId: user.id,
          phone: user.phone,
          email: user.email,
          displayName: user.displayName ?? user.email,
        };
      }

      case "VIP_ACCOUNT_MEMBER": {
        // Query wholesale_account
        const [account] = await this.db
          .select()
          .from(wholesaleAccount)
          .where(eq(wholesaleAccount.id, recipientId))
          .limit(1);

        if (!account) {
          throw new NotificationRecipientNotFoundError(recipientType, recipientId);
        }

        // Query primary contact user
        const [user] = await this.db
          .select()
          .from(accountUser)
          .where(eq(accountUser.id, account.userId))
          .limit(1);

        return {
          recipientType,
          recipientId,
          userId: account.userId,
          phone: user?.phone ?? account.phone,
          email: user?.email,
          displayName: account.storeName ?? account.memberName,
        };
      }

      case "SUPPLIER_MEMBER": {
        // Query supplier_member
        const [member] = await this.db
          .select()
          .from(supplierMember)
          .where(eq(supplierMember.id, recipientId))
          .limit(1);

        if (!member) {
          throw new NotificationRecipientNotFoundError(recipientType, recipientId);
        }

        const [user] = await this.db
          .select()
          .from(accountUser)
          .where(eq(accountUser.id, member.userId))
          .limit(1);

        return {
          recipientType,
          recipientId,
          userId: member.userId,
          phone: user?.phone,
          email: user?.email,
          displayName: user?.displayName ?? user?.email,
        };
      }

      default:
        throw new NotificationRecipientNotFoundError(recipientType, recipientId);
    }
  }

  /**
   * Retrieve event by ID.
   */
  public async getEvent(eventId: string) {
    const [ev] = await this.db
      .select()
      .from(notificationEvent)
      .where(eq(notificationEvent.id, eventId))
      .limit(1);
    return ev ?? null;
  }
}
