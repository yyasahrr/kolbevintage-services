import { Inject, Injectable } from "@nestjs/common";
import { InvoicingDomainError } from "./invoicing.errors";
import { FakeTaxInvoiceProvider } from "./providers/fake-tax-invoice.provider";
import type { TaxInvoiceProvider } from "./tax-invoice-provider.interface";

/**
 * TAX_INVOICE_PROVIDER_MODE:
 *   - unset / "disabled" → no fiscal submission possible (FISCAL_PROVIDER_NOT_CONFIGURED)
 *   - "fake"             → deterministic fake; REFUSED when NODE_ENV=production
 * No real provider name is registered in this phase.
 */
@Injectable()
export class TaxInvoiceProviderRegistry {
  constructor(@Inject(FakeTaxInvoiceProvider) private readonly fake: FakeTaxInvoiceProvider) {}

  mode(): string {
    return (process.env.TAX_INVOICE_PROVIDER_MODE || (process.env.NODE_ENV === "production" ? "disabled" : "fake")).trim().toLowerCase();
  }

  resolve(requested?: string | null): TaxInvoiceProvider {
    const mode = this.mode();
    const name = (requested || mode).trim().toLowerCase();
    if (mode === "disabled" || name === "disabled") {
      throw new InvoicingDomainError("FISCAL_PROVIDER_NOT_CONFIGURED", "ارائه‌دهندهٔ صورتحساب الکترونیکی پیکربندی نشده است");
    }
    if (name === "fake") {
      if (process.env.NODE_ENV === "production") {
        throw new InvoicingDomainError("FISCAL_PROVIDER_NOT_ALLOWED_IN_PRODUCTION", "ارائه‌دهندهٔ آزمایشی در production مجاز نیست");
      }
      if (mode !== "fake") throw new InvoicingDomainError("FISCAL_PROVIDER_NOT_CONFIGURED", "حالت ارائه‌دهنده با درخواست مطابقت ندارد");
      return this.fake;
    }
    throw new InvoicingDomainError("FISCAL_PROVIDER_NOT_CONFIGURED", `ارائه‌دهندهٔ ${name} ثبت نشده است`);
  }
}
