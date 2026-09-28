import { DomainError } from "@kolbe/shared";

const NOT_FOUND = new Set(["INVOICE_NOT_FOUND", "FISCAL_DOCUMENT_NOT_FOUND", "TAX_CONFIG_NOT_FOUND", "ORDER_NOT_FOUND", "CHILD_ORDER_NOT_FOUND"]);
const FORBIDDEN = new Set(["INVOICE_ACCESS_DENIED", "ROLE_NOT_ALLOWED", "SUPPLIER_MEMBERSHIP_REQUIRED", "FISCAL_PROVIDER_NOT_ALLOWED_IN_PRODUCTION"]);
const CONFLICT = new Set([
  "INVOICE_NOT_ELIGIBLE",
  "INVOICE_ALREADY_ISSUED",
  "INVOICE_INVALID_TRANSITION",
  "FISCAL_SUBMISSION_INVALID_STATE",
  "FISCAL_DOCUMENT_EXISTS",
  "FISCAL_VALIDATION_FAILED",
  "TAX_CONFIG_INVALID_TRANSITION",
  "TAX_CONFIG_NOT_VERIFIED",
  "IDEMPOTENCY_KEY_REUSED",
]);
const SERVICE_UNAVAILABLE = new Set(["FISCAL_PROVIDER_NOT_CONFIGURED"]);

export class InvoicingDomainError extends DomainError {
  constructor(code: string, message: string, status?: number) {
    let resolved = status ?? 400;
    if (status === undefined) {
      if (NOT_FOUND.has(code)) resolved = 404;
      else if (FORBIDDEN.has(code)) resolved = 403;
      else if (CONFLICT.has(code)) resolved = 409;
      else if (SERVICE_UNAVAILABLE.has(code)) resolved = 503;
      else if (code === "FISCAL_PROVIDER_ERROR") resolved = 502;
    }
    super(resolved, code, message);
    this.name = "InvoicingDomainError";
  }
}
