/**
 * Phase 4.7.5 — TaxInvoiceProvider port (tax readiness only).
 *
 * This is the seam where a real Iranian electronic-invoice integration
 * (سامانه مؤدیان — INTA) would be plugged in. NO real HTTP integration, schema
 * or credential exists in this repository. The fake adapter is deterministic
 * and is refused in production (see TaxInvoiceProviderRegistry).
 */
export type FiscalInvoiceSnapshot = {
  invoiceId: string;
  invoiceNumber: string;
  issuedAt: string;
  currency: string;
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  lines: Array<{ lineNo: number; description: string; quantity: number; unitPrice: string; lineTotal: string }>;
  totals: { subtotal: string; shippingTotal: string; taxTotal: string; grandTotal: string; taxStatus: string; taxBasisReference: string | null };
  documentHash: string;
};

export type FiscalPrepareResult = { payload: Record<string, unknown>; payloadHash: string };
export type FiscalValidationResult = { valid: boolean; problems: string[] };
export type FiscalSubmitResult = { status: "submitted" | "accepted" | "rejected"; providerReference: string | null; message?: string | null };
export type FiscalStatusResult = { status: "submitted" | "accepted" | "rejected"; providerReference: string | null; message?: string | null };

export interface TaxInvoiceProvider {
  readonly name: string;
  /** True only for a real tax-authority integration. The fake adapter is never "real". */
  readonly isRealAuthorityIntegration: boolean;
  prepare(snapshot: FiscalInvoiceSnapshot): Promise<FiscalPrepareResult>;
  validate(payload: Record<string, unknown>): Promise<FiscalValidationResult>;
  submit(input: { payload: Record<string, unknown>; payloadHash: string; idempotencyKey: string }): Promise<FiscalSubmitResult>;
  queryStatus(input: { providerReference: string }): Promise<FiscalStatusResult>;
}
