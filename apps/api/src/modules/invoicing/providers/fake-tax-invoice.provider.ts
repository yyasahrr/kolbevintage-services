import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FiscalInvoiceSnapshot, FiscalPrepareResult, FiscalStatusResult, FiscalSubmitResult, FiscalValidationResult, TaxInvoiceProvider } from "../tax-invoice-provider.interface";

/**
 * Deterministic fake — for tests and local development ONLY.
 * It never talks to any tax authority and is refused in production by the registry.
 */
@Injectable()
export class FakeTaxInvoiceProvider implements TaxInvoiceProvider {
  readonly name = "fake";
  readonly isRealAuthorityIntegration = false;
  /** Test hook: force the next submit/query outcome. */
  forcedOutcome: "submitted" | "accepted" | "rejected" | null = null;

  async prepare(snapshot: FiscalInvoiceSnapshot): Promise<FiscalPrepareResult> {
    const payload = {
      providerSchema: "fake/v1",
      invoiceNumber: snapshot.invoiceNumber,
      issuedAt: snapshot.issuedAt,
      currency: snapshot.currency,
      seller: snapshot.seller,
      buyer: snapshot.buyer,
      lines: snapshot.lines,
      totals: snapshot.totals,
      documentHash: snapshot.documentHash,
    };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return { payload, payloadHash };
  }

  async validate(payload: Record<string, unknown>): Promise<FiscalValidationResult> {
    const problems: string[] = [];
    const totals = (payload.totals ?? {}) as Record<string, string>;
    if (!payload.invoiceNumber) problems.push("invoiceNumber missing");
    if (!Array.isArray(payload.lines) || (payload.lines as unknown[]).length === 0) problems.push("lines missing");
    if (!totals.grandTotal) problems.push("grandTotal missing");
    const seller = (payload.seller ?? {}) as Record<string, unknown>;
    if (!seller.legalName) problems.push("seller.legalName missing (business legal profile not configured)");
    return { valid: problems.length === 0, problems };
  }

  async submit(input: { payload: Record<string, unknown>; payloadHash: string; idempotencyKey: string }): Promise<FiscalSubmitResult> {
    const providerReference = `FAKE-${input.payloadHash.slice(0, 12).toUpperCase()}`;
    const status = this.forcedOutcome ?? "submitted";
    return { status, providerReference, message: `fake provider (${status})` };
  }

  async queryStatus(input: { providerReference: string }): Promise<FiscalStatusResult> {
    const status = this.forcedOutcome ?? "accepted";
    return { status, providerReference: input.providerReference, message: `fake provider (${status}) — NOT a tax-authority acknowledgement` };
  }
}
