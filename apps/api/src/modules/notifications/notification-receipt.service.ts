import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import {
  notificationDelivery,
  notificationProviderEvent,
  type NotificationProviderEventStatus,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  NotificationProviderSignatureError,
  NotificationProviderUnavailableError,
} from "./notifications.errors";
import {
  EmailProvider,
  SmsProvider,
} from "./notification-provider.interface";
import { FakeEmailProvider, FakeSmsProvider } from "./providers/test-providers";

export interface DeliveryReceiptPayload {
  externalEventId?: string;
  externalMessageId: string;
  eventType: "DELIVERED" | "BOUNCED" | "FAILED" | "REJECTED";
  reason?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationReceiptService {
  private smsProvider: SmsProvider;
  private emailProvider: EmailProvider;

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FakeSmsProvider) fakeSms: FakeSmsProvider,
    @Inject(FakeEmailProvider) fakeEmail: FakeEmailProvider,
  ) {
    this.smsProvider = fakeSms;
    this.emailProvider = fakeEmail;
  }

  public setSmsProvider(provider: SmsProvider) {
    this.smsProvider = provider;
  }

  public setEmailProvider(provider: EmailProvider) {
    this.emailProvider = provider;
  }

  /**
   * Ingest provider delivery receipt webhook with signature verification and idempotent state transition.
   */
  public async ingestReceipt(
    providerKey: string,
    rawPayload: string,
    signature: string,
  ): Promise<{
    eventId: string;
    processingStatus: NotificationProviderEventStatus;
    deliveryId?: string | null;
    isDuplicate: boolean;
  }> {
    // 1. Resolve provider and verify signature
    let provider: SmsProvider | EmailProvider | null = null;
    if (this.smsProvider.providerKey === providerKey) {
      provider = this.smsProvider;
    } else if (this.emailProvider.providerKey === providerKey) {
      provider = this.emailProvider;
    }

    if (!provider) {
      throw new NotificationProviderUnavailableError(providerKey, "Unknown provider key");
    }

    const isValidSignature = provider.verifyWebhookSignature(rawPayload, signature);
    if (!isValidSignature) {
      throw new NotificationProviderSignatureError(providerKey);
    }

    // 2. Parse payload
    let parsed: DeliveryReceiptPayload;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new Error("Invalid webhook JSON payload");
    }

    const externalEventId =
      parsed.externalEventId ??
      crypto.createHash("sha256").update(`${parsed.externalMessageId}:${parsed.eventType}`).digest("hex");

    // 3. Deduplication check in raw provider event table
    const [existing] = await this.db
      .select()
      .from(notificationProviderEvent)
      .where(
        and(
          eq(notificationProviderEvent.providerKey, providerKey),
          eq(notificationProviderEvent.externalEventId, externalEventId),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        eventId: existing.id,
        processingStatus: existing.processingStatus as NotificationProviderEventStatus,
        deliveryId: existing.deliveryId,
        isDuplicate: true,
      };
    }

    // 4. Ingest new event record
    const eventId = `npe_${crypto.randomUUID()}`;

    // Correlate with delivery outbox
    const [matchingDelivery] = await this.db
      .select()
      .from(notificationDelivery)
      .where(
        and(
          eq(notificationDelivery.providerKey, providerKey),
          eq(notificationDelivery.providerMessageId, parsed.externalMessageId),
        ),
      )
      .limit(1);

    let processingStatus: NotificationProviderEventStatus = "PROCESSED";
    let errorMessage: string | null = null;

    if (!matchingDelivery) {
      processingStatus = "IGNORED";
      errorMessage = `No delivery found for message '${parsed.externalMessageId}' on provider '${providerKey}'`;
    } else {
      // Idempotent state transitions
      if (parsed.eventType === "DELIVERED") {
        if (matchingDelivery.status !== "DELIVERED") {
          await this.db
            .update(notificationDelivery)
            .set({
              status: "DELIVERED",
              deliveredAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(notificationDelivery.id, matchingDelivery.id));
        }
      } else if (
        parsed.eventType === "BOUNCED" ||
        parsed.eventType === "FAILED" ||
        parsed.eventType === "REJECTED"
      ) {
        if (matchingDelivery.status !== "FAILED_PERMANENT") {
          await this.db
            .update(notificationDelivery)
            .set({
              status: "FAILED_PERMANENT",
              failedAt: new Date(),
              failureCategory: parsed.eventType === "BOUNCED" ? "HARD_BOUNCE" : "PROVIDER_REJECTED",
              failureDetail: parsed.reason ?? "Provider reported final non-delivery",
              updatedAt: new Date(),
            })
            .where(eq(notificationDelivery.id, matchingDelivery.id));
        }
      }
    }

    const [created] = await this.db
      .insert(notificationProviderEvent)
      .values({
        id: eventId,
        providerKey,
        externalEventId,
        eventType: parsed.eventType,
        payload: parsed as unknown as Record<string, unknown>,
        signatureVerified: true,
        processingStatus,
        deliveryId: matchingDelivery?.id ?? null,
        processedAt: new Date(),
        errorMessage,
      })
      .returning();

    return {
      eventId: created.id,
      processingStatus,
      deliveryId: matchingDelivery?.id ?? null,
      isDuplicate: false,
    };
  }

  /**
   * Retrieve provider events for audit / debugging.
   */
  public async getProviderEvent(eventId: string) {
    const [ev] = await this.db
      .select()
      .from(notificationProviderEvent)
      .where(eq(notificationProviderEvent.id, eventId))
      .limit(1);

    return ev ?? null;
  }
}
