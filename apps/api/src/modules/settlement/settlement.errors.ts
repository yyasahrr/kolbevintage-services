import { DomainError } from "@kolbe/shared";

const NOT_FOUND = new Set([
  "SETTLEMENT_ACCOUNT_NOT_FOUND",
  "SETTLEMENT_JOURNAL_NOT_FOUND",
  "SETTLEMENT_BATCH_NOT_FOUND",
  "SETTLEMENT_HOLD_NOT_FOUND",
  "WITHDRAWAL_NOT_FOUND",
  "PAYOUT_NOT_FOUND",
  "SUPPLIER_NOT_FOUND",
  "CHILD_ORDER_NOT_FOUND",
]);

const FORBIDDEN = new Set([
  "WITHDRAWAL_ACCESS_DENIED",
  "PAYOUT_ACCESS_DENIED",
  "SETTLEMENT_ACCESS_DENIED",
  "SUPPLIER_MEMBERSHIP_REQUIRED",
  "PAYOUT_PROVIDER_NOT_ALLOWED",
  "FAKE_PAYOUT_PROVIDER_FORBIDDEN_IN_PRODUCTION",
]);

const CONFLICT = new Set([
  "SETTLEMENT_SOURCE_EVENT_ALREADY_POSTED",
  "SETTLEMENT_JOURNAL_UNBALANCED",
  "WITHDRAWAL_ALREADY_RESERVED",
  "WITHDRAWAL_INVALID_TRANSITION",
  "PAYOUT_INVALID_TRANSITION",
  "PAYOUT_ALREADY_FINAL",
  "SETTLEMENT_BATCH_INVALID_STATE",
  "SETTLEMENT_HOLD_ALREADY_RELEASED",
  "IDEMPOTENCY_CONFLICT",
]);

const SERVICE_UNAVAILABLE = new Set([
  "PAYOUT_PROVIDER_UNAVAILABLE",
  "LEGAL_GATE_UNAVAILABLE",
]);

export class SettlementDomainError extends DomainError {
  constructor(code: string, message: string, status?: number) {
    let resolved = status ?? 400;
    if (status === undefined) {
      if (NOT_FOUND.has(code)) resolved = 404;
      else if (FORBIDDEN.has(code)) resolved = 403;
      else if (CONFLICT.has(code)) resolved = 409;
      else if (SERVICE_UNAVAILABLE.has(code)) resolved = 503;
      else if (code === "PAYOUT_PROVIDER_ERROR") resolved = 502;
    }
    super(resolved, code, message);
    this.name = "SettlementDomainError";
  }
}
