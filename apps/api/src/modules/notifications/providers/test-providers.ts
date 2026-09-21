import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import {
  EmailProvider,
  EmailSendRequest,
  EmailSendResult,
  SmsProvider,
  SmsSendRequest,
  SmsSendResult,
} from "../notification-provider.interface";

@Injectable()
export class FakeSmsProvider implements SmsProvider {
  public readonly providerKey = "fake_sms";
  public sentMessages: Array<SmsSendRequest & { sentAt: Date; externalMessageId: string }> = [];
  public failureMode: "NONE" | "RETRYABLE" | "PERMANENT" = "NONE";
  public webhookSecret = "test_sms_webhook_secret_123";

  public async send(req: SmsSendRequest): Promise<SmsSendResult> {
    if (this.failureMode === "RETRYABLE") {
      return {
        success: false,
        isRetryable: true,
        errorCategory: "NETWORK_TIMEOUT",
        errorDetail: "Simulated SMS gateway connection timeout",
        retryAfterSeconds: 5,
      };
    }

    if (this.failureMode === "PERMANENT") {
      return {
        success: false,
        isRetryable: false,
        errorCategory: "INVALID_DESTINATION",
        errorDetail: "Simulated destination unallocated or blocked",
      };
    }

    // Check if phone number is obviously invalid (e.g. less than 10 digits)
    if (!req.to || req.to.replace(/\D/g, "").length < 10) {
      return {
        success: false,
        isRetryable: false,
        errorCategory: "INVALID_DESTINATION",
        errorDetail: `Invalid mobile phone number format: '${req.to}'`,
      };
    }

    const externalMessageId = `sms_msg_${crypto.randomUUID()}`;
    this.sentMessages.push({
      ...req,
      sentAt: new Date(),
      externalMessageId,
    });

    return {
      success: true,
      externalMessageId,
    };
  }

  public verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!signature) return false;
    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  public generateWebhookSignature(payload: string): string {
    return crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");
  }

  public clear(): void {
    this.sentMessages = [];
    this.failureMode = "NONE";
  }
}

@Injectable()
export class FakeEmailProvider implements EmailProvider {
  public readonly providerKey = "fake_email";
  public sentEmails: Array<EmailSendRequest & { sentAt: Date; externalMessageId: string }> = [];
  public failureMode: "NONE" | "RETRYABLE" | "PERMANENT" = "NONE";
  public webhookSecret = "test_email_webhook_secret_456";

  public async send(req: EmailSendRequest): Promise<EmailSendResult> {
    if (this.failureMode === "RETRYABLE") {
      return {
        success: false,
        isRetryable: true,
        errorCategory: "SMTP_5XX_TEMPORARY",
        errorDetail: "Simulated SMTP server busy",
        retryAfterSeconds: 10,
      };
    }

    if (this.failureMode === "PERMANENT") {
      return {
        success: false,
        isRetryable: false,
        errorCategory: "MAILBOX_DOES_NOT_EXIST",
        errorDetail: "Simulated mailbox unavailable or bounced",
      };
    }

    // Check if email contains CRLF injection in subject or destination
    if (req.subject.includes("\r") || req.subject.includes("\n") || req.to.includes("\r") || req.to.includes("\n")) {
      return {
        success: false,
        isRetryable: false,
        errorCategory: "HEADER_INJECTION_DETECTED",
        errorDetail: "CRLF character detected in email headers",
      };
    }

    const externalMessageId = `eml_msg_${crypto.randomUUID()}`;
    this.sentEmails.push({
      ...req,
      sentAt: new Date(),
      externalMessageId,
    });

    return {
      success: true,
      externalMessageId,
    };
  }

  public verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!signature) return false;
    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  public generateWebhookSignature(payload: string): string {
    return crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");
  }

  public clear(): void {
    this.sentEmails = [];
    this.failureMode = "NONE";
  }
}
