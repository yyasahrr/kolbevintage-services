import { DomainError } from "@kolbe/shared";

/**
 * Phase 4.7.5 — stable compliance error codes.
 *
 * Every code maps to exactly one HTTP status so clients (checkout, portal,
 * admin) can branch on `error` without parsing Persian messages.
 */
const NOT_FOUND = new Set([
  "LEGAL_POLICY_NOT_FOUND",
  "SUPPLIER_COMPLIANCE_PROFILE_NOT_FOUND",
  "COMPLIANCE_DOCUMENT_NOT_FOUND",
  "PRODUCT_COMPLIANCE_RECORD_NOT_FOUND",
  "DATA_SUBJECT_REQUEST_NOT_FOUND",
  "HOLD_NOT_FOUND",
  "CREDENTIAL_NOT_FOUND",
  "RETENTION_POLICY_NOT_FOUND",
  "COMPLIANCE_SNAPSHOT_NOT_FOUND",
  "BANK_VERIFICATION_NOT_FOUND",
  "SUPPLIER_NOT_FOUND",
]);

const FORBIDDEN = new Set([
  "COMPLIANCE_ACCESS_DENIED",
  "SUPPLIER_MEMBERSHIP_REQUIRED",
  "SUPPLIER_ROLE_NOT_AUTHORIZED",
  "DOCUMENT_ACCESS_DENIED",
  "ROLE_NOT_ALLOWED",
  "DOCUMENT_URL_INVALID",
]);

const CONFLICT = new Set([
  "LEGAL_POLICY_ACCEPTANCE_REQUIRED",
  "LEGAL_POLICY_REACCEPTANCE_REQUIRED",
  "LEGAL_POLICY_VERSION_NOT_ACTIVE",
  "LEGAL_POLICY_IMMUTABLE",
  "LEGAL_POLICY_INVALID_TRANSITION",
  "LEGAL_POLICY_VERSION_EXISTS",
  "SUPPLIER_COMPLIANCE_INVALID_TRANSITION",
  "SUPPLIER_COMPLIANCE_PROFILE_INCOMPLETE",
  "SUPPLIER_COMPLIANCE_PROFILE_LOCKED",
  "SUPPLIER_COMPLIANCE_NOT_APPROVED",
  "SUPPLIER_CONTRACT_NOT_ACCEPTED",
  "SUPPLIER_COMPLIANCE_HOLD_ACTIVE",
  "HOLD_ALREADY_RELEASED",
  "PRODUCT_COMPLIANCE_BLOCKED",
  "PRODUCT_COMPLIANCE_INVALID_TRANSITION",
  "DATA_SUBJECT_REQUEST_INVALID_STATE",
  "LEGAL_HOLD_ACTIVE",
  "RETENTION_POLICY_NOT_VERIFIED",
  "RETENTION_POLICY_INVALID_TRANSITION",
  "CREDENTIAL_INVALID_TRANSITION",
  "BANK_VERIFICATION_INVALID_TRANSITION",
  "DOCUMENT_REVIEW_INVALID_TRANSITION",
  "DOCUMENT_URL_EXPIRED",
  "TRANSACTION_SNAPSHOT_EXISTS",
  "RETAIL_DISCLOSURE_INCOMPLETE",
]);

const PAYLOAD_TOO_LARGE = new Set(["DOCUMENT_TOO_LARGE"]);
const UNSUPPORTED_MEDIA = new Set(["DOCUMENT_TYPE_NOT_ALLOWED"]);
const SERVER = new Set(["COMPLIANCE_HASH_KEY_MISSING", "COMPLIANCE_STORAGE_UNAVAILABLE"]);

export class ComplianceDomainError extends DomainError {
  constructor(code: string, message: string, status?: number) {
    let resolved = status ?? 400;
    if (status === undefined) {
      if (NOT_FOUND.has(code)) resolved = 404;
      else if (FORBIDDEN.has(code)) resolved = 403;
      else if (CONFLICT.has(code)) resolved = 409;
      else if (PAYLOAD_TOO_LARGE.has(code)) resolved = 413;
      else if (UNSUPPORTED_MEDIA.has(code)) resolved = 415;
      else if (SERVER.has(code)) resolved = 500;
    }
    super(resolved, code, message);
    this.name = "ComplianceDomainError";
  }
}

export function requireString(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ComplianceDomainError("VALIDATION_ERROR", `${field} الزامی است`, 400);
  }
  if (value.length > max) throw new ComplianceDomainError("VALIDATION_ERROR", `${field} بیش از حد طولانی است`, 400);
  return value.trim();
}

export function optionalString(value: unknown, field: string, max = 512): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ComplianceDomainError("VALIDATION_ERROR", `${field} نامعتبر است`, 400);
  if (value.length > max) throw new ComplianceDomainError("VALIDATION_ERROR", `${field} بیش از حد طولانی است`, 400);
  return value.trim();
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ComplianceDomainError("VALIDATION_ERROR", `${field} باید یکی از ${allowed.join("، ")} باشد`, 400);
  }
  return value as T;
}
