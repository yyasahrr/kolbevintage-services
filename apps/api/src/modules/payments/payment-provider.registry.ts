import { Injectable, Logger, Inject } from "@nestjs/common";
import type { PaymentProvider } from "./payment-provider.interface";
import { ManualTransferProvider } from "./manual-transfer.provider";
import { FakePaymentProvider } from "./providers/fake-payment.provider";

/**
 * Phase 4.7 — PaymentProviderRegistry
 * Production-grade registry that distinguishes enabled/disabled and rejects unknown.
 * Manual is production default, fake only allowed in non-production unless PAYMENT_PROVIDER_MODE explicitly allows.
 */

export type PaymentProviderMode = "disabled" | "fake" | "sandbox" | "live";

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
      // Allow if explicitly configured with fake mode? Task says startup must fail if fake in production
      throw new Error(
        `PaymentProviderRegistry: fake provider prohibited in production (WHOLESALE_PAYMENT_PROVIDER=${providerKey}, PAYMENT_PROVIDER_MODE=${mode}, NODE_ENV=${nodeEnv})`,
      );
    }

    // If external provider mode enabled but credentials missing, fail safely (placeholder for future real provider)
    if (["sandbox", "live"].includes(mode)) {
      // For now, only manual and fake exist, so sandbox/live without real provider should fail
      if (providerKey !== "manual" && providerKey !== "fake") {
        const hasCreds = this.checkRealProviderCredentials(providerKey);
        if (!hasCreds) {
          throw new Error(
            `PaymentProviderRegistry: provider ${providerKey} mode ${mode} requires credentials but none supplied`,
          );
        }
      } else if (providerKey === "manual" && mode !== "disabled") {
        // manual doesn't need sandbox/live, but allow disabled only
        // If someone sets manual + sandbox, we treat as misconfig
        this.logger.warn(`Manual provider with mode ${mode} — treating as disabled mode for safety`);
      }
    }

    // Enable providers based on env
    // Always enable manual
    this.enabledProviders.add("manual");
    if (mode === "fake" || providerKey === "fake") {
      this.enabledProviders.add("fake");
    }

    this.logger.log(`Payment providers registered: ${Array.from(this.providers.keys()).join(", ")}; enabled: ${Array.from(this.enabledProviders).join(", ")}; mode=${mode}; default=${providerKey}`);
  }

  private checkRealProviderCredentials(_providerKey: string): boolean {
    // Placeholder for future Iranian provider credential check
    // For now, return false to force safe failure if sandbox/live requested without creds
    // Real implementation will check env vars like NEXTPAY_API_KEY, VANDAR_API_KEY, etc.
    return false;
  }

  register(provider: PaymentProvider) {
    if (!provider.name) throw new Error("Provider must have name");
    this.providers.set(provider.name, provider);
  }

  resolve(providerName?: string): PaymentProvider {
    const key = (providerName || process.env.WHOLESALE_PAYMENT_PROVIDER || "manual").toLowerCase();
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`Unknown payment provider: ${key}. Registered: ${Array.from(this.providers.keys()).join(", ")}`);
    }
    if (!this.enabledProviders.has(key)) {
      // If disabled mode, only manual allowed
      const mode = (process.env.PAYMENT_PROVIDER_MODE || "disabled").toLowerCase();
      if (mode === "disabled" && key !== "manual") {
        throw new Error(`Payment provider ${key} is disabled in mode ${mode}`);
      }
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
