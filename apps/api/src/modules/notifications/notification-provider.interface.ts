export interface SmsSendRequest {
  to: string;
  body: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface SmsSendResult {
  success: boolean;
  externalMessageId?: string;
  isRetryable?: boolean;
  errorCategory?: string;
  errorDetail?: string;
  retryAfterSeconds?: number;
}

export interface EmailSendRequest {
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  success: boolean;
  externalMessageId?: string;
  isRetryable?: boolean;
  errorCategory?: string;
  errorDetail?: string;
  retryAfterSeconds?: number;
}

export interface SmsProvider {
  readonly providerKey: string;
  send(req: SmsSendRequest): Promise<SmsSendResult>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

export interface EmailProvider {
  readonly providerKey: string;
  send(req: EmailSendRequest): Promise<EmailSendResult>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}
