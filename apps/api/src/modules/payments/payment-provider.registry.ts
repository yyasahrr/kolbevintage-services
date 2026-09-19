import { Injectable, Logger, Inject } from "@nestjs/common";
import { DomainError } from "@kolbe/shared";
import type { PaymentProvider } from "./payment-provider.interface";
import { ManualTransferProvider } from "./manual-transfer.provider";
import { FakePaymentProvider } from "./providers/fake-payment.provider";

/**
 * Phase 4.7 — PaymentProviderRegistry
 * Production-grade registry that distinguishes enabled/disabled and rejects unknown.
 * Manual is production default, fake only allowed in non-production unless PAYMENT_PROVIDER_MODE explicitly allows.
 *
 * Phase 4.7.1 (A10): the production guard is enforced at the *resolve boundary*
 * (every intent / webhook / reconciliation / refund call), not only at startup,
 * and every rejection is a stable DomainError instead of a generic Error.
 */

export type PaymentProviderMode = "disabled" | "fake" | "sandbox" | "live";

export class PaymentProviderRegistryError extends DomainError {
  constructor(code: "PROVIDER_NOT_ALLOWED" | "PAYMENT_PROVIDER_UNKNOWN", message: string) {
    super(code === "PAYMENT_PROVIDER_UNKNOWN" ? 404 : 403, code, message);
    this.name = "PaymentProviderRegistryError";
  }
}

export function isProductionEnv(): boolean {
  return (process.env.NODE_ENV || "development").toLowerCase() === "production";
}

@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly enabledProviders = new Set<string>();

  constructor(
    @Inject(ManualTransferProvider) private readonly manualProvider: ManualTransferProvider,
    @Inject(FakePaymentProvider) private readonly fakeProvider: FakePaymentProvider,
  ) {
    this.register(this.manualProvider);
    this.register(this.fakeProvider);
    this.configureFromEnv();
  }

  private configureFromEnv() {
    const providerKey = (process.env.WHOLESALE_PAYMENT_PROVIDER || "manual").toLowerCase();
    const mode = (process.env.PAYMENT_PROVIDER_MODE || "disabled").toLowerCase() as PaymentProviderMode;
    const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();

    // Production guard: fake must never be silent default in production
    if (nodeEnv === "production" && (providerKey === "fake" || mode === "fake")) {
      throw new Error(
        `PaymentProviderRegistry: fake provider prohibited in production (WHOLESALE_PAYMENT_PROVIDER=${providerKey}, PAYMENT_PROVIDER_MODE=${mode}, NODE_ENV=${nodeEnv})`,
      );
    }

    // If external provider mode enabled but credentials missing, fail safely (placeholder for future real provider)
    if (["sandbox", "live"].includes(mode)) {
      if (providerKey !== "manual" && providerKey !== "fake") {
        const hasCreds = this.checkRealProviderCredentials(providerKey);
        if (!hasCreds) {
          throw new Error(
            `PaymentProviderRegistry: provider ${providerKey} mode ${mode} requires credentials but none supplied`,
          );
        }
      } else if (providerKey === "manual" && mode !== "disabled") {
        this.logger.warn(`Manual provider with mode ${mode} — treating as disabled mode for safety`);
      }
    }

    // Always enable manual
    this.enabledProviders.add("manual");
    if (mode === "fake" || providerKey === "fake") {
      this.enabledProviders.add("fake");
    }

    this.logger.log(`Payment providers registered: ${Array.from(this.providers.keys()).join(", ")}; enabled: ${Array.from(this.enabledProviders).join(", ")}; mode=${mode}; default=${providerKey}`);
  }

  private checkRealProviderCredentials(_providerKey: string): boolean {
    // No real Iranian gateway is integrated in this phase; sandbox/live without an
    // adapter must fail closed. (Credential checks arrive with the adapter itself.)
    return false;
  }

  register(provider: PaymentProvider) {
    if (!provider.name) throw new Error("Provider must have name");
    this.providers.set(provider.name, provider);
  }

  /**
   * Resolve a provider for an operation. Fails closed:
   *  - unknown name → PAYMENT_PROVIDER_UNKNOWN (404)
   *  - fake in production → PROVIDER_NOT_ALLOWED (403), regardless of env flags
   *  - not enabled by configuration → PROVIDER_NOT_ALLOWED (403)
   */
  resolve(providerName?: string): PaymentProvider {
    const key = (providerName || process.env.WHOLESALE_PAYMENT_PROVIDER || "manual").toLowerCase();
    if (key === "fake" && isProductionEnv()) {
      throw new PaymentProviderRegistryError("PROVIDER_NOT_ALLOWED", "Fake payment provider is prohibited in production");
    }
    const provider = this.providers.get(key);
    if (!provider) {
      throw new PaymentProviderRegistryError("PAYMENT_PROVIDER_UNKNOWN", `Unknown payment provider: ${key}`);
    }
    if (!this.enabledProviders.has(key)) {
      throw new PaymentProviderRegistryError("PROVIDER_NOT_ALLOWED", `Payment provider ${key} is not enabled (mode=${this.getMode()})`);
    }
    return provider;
  }

  getDefaultProvider(): PaymentProvider {
    return this.resolve();
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  isEnabled(name: string): boolean {
    return this.enabledProviders.has(name);
  }

  getMode(): PaymentProviderMode {
    return (process.env.PAYMENT_PROVIDER_MODE || "disabled").toLowerCase() as PaymentProviderMode;
  }
}
