import { Injectable, Logger, Inject } from "@nestjs/common";
import { DomainError } from "@kolbe/shared";
import type { ShippingProvider } from "./shipping-provider.interface";
import { ManualShippingProvider } from "./providers/manual-shipping.provider";
import { FakeShippingProvider } from "./providers/fake-shipping.provider";

export type ShippingProviderMode = "disabled" | "fake" | "sandbox" | "live";

export class ShippingProviderRegistryError extends DomainError {
  constructor(code: "PROVIDER_NOT_ALLOWED" | "SHIPPING_PROVIDER_UNKNOWN", message: string) {
    super(code === "SHIPPING_PROVIDER_UNKNOWN" ? 404 : 403, code, message);
    this.name = "ShippingProviderRegistryError";
  }
}

/**
 * Phase 4.7.1 (A10): the production guard is enforced at the *resolve boundary*
 * for every quote / shipment / webhook / reconciliation call, and rejections are
 * stable DomainErrors.
 */
@Injectable()
export class ShippingProviderRegistry {
  private readonly logger = new Logger(ShippingProviderRegistry.name);
  private readonly providers = new Map<string, ShippingProvider>();
  private readonly enabled = new Set<string>();

  constructor(
    @Inject(ManualShippingProvider) private readonly manualProvider: ManualShippingProvider,
    @Inject(FakeShippingProvider) private readonly fakeProvider: FakeShippingProvider,
  ) {
    this.register(this.manualProvider);
    this.register(this.fakeProvider);
    this.configureFromEnv();
  }

  private configureFromEnv() {
    const providerKey = (process.env.WHOLESALE_SHIPPING_PROVIDER || "manual").toLowerCase();
    const mode = (process.env.SHIPPING_PROVIDER_MODE || "disabled").toLowerCase() as ShippingProviderMode;
    const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();

    if (nodeEnv === "production" && (providerKey === "fake" || mode === "fake")) {
      throw new Error(
        `ShippingProviderRegistry: fake provider prohibited in production (WHOLESALE_SHIPPING_PROVIDER=${providerKey}, SHIPPING_PROVIDER_MODE=${mode}, NODE_ENV=${nodeEnv})`,
      );
    }

    if (["sandbox", "live"].includes(mode)) {
      if (providerKey !== "manual" && providerKey !== "fake") {
        const hasCreds = false; // no real carrier adapter is integrated in this phase — fail closed
        if (!hasCreds) {
          throw new Error(`ShippingProviderRegistry: provider ${providerKey} mode ${mode} requires credentials but none supplied`);
        }
      }
    }

    this.enabled.add("manual");
    if (mode === "fake" || providerKey === "fake") {
      this.enabled.add("fake");
    }

    this.logger.log(`Shipping providers registered: ${Array.from(this.providers.keys()).join(", ")}; enabled: ${Array.from(this.enabled).join(", ")}; mode=${mode}; default=${providerKey}`);
  }

  register(provider: ShippingProvider) {
    this.providers.set(provider.name, provider);
  }

  resolve(name?: string): ShippingProvider {
    const key = (name || process.env.WHOLESALE_SHIPPING_PROVIDER || "manual").toLowerCase();
    if (key === "fake" && (process.env.NODE_ENV || "development").toLowerCase() === "production") {
      throw new ShippingProviderRegistryError("PROVIDER_NOT_ALLOWED", "Fake shipping provider is prohibited in production");
    }
    const provider = this.providers.get(key);
    if (!provider) {
      throw new ShippingProviderRegistryError("SHIPPING_PROVIDER_UNKNOWN", `Unknown shipping provider: ${key}`);
    }
    if (!this.enabled.has(key)) {
      throw new ShippingProviderRegistryError("PROVIDER_NOT_ALLOWED", `Shipping provider ${key} is not enabled (mode=${this.getMode()})`);
    }
    return provider;
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  isEnabled(name: string): boolean {
    return this.enabled.has(name);
  }

  getMode(): ShippingProviderMode {
    return (process.env.SHIPPING_PROVIDER_MODE || "disabled").toLowerCase() as ShippingProviderMode;
  }
}
