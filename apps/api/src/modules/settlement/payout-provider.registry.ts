import { Inject, Injectable } from "@nestjs/common";
import { PayoutProvider } from "./payout-provider.interface";
import { FakePayoutProvider } from "./providers/fake-payout.provider";
import { ManualPayoutProvider } from "./providers/manual-payout.provider";
import { SettlementDomainError } from "./settlement.errors";

@Injectable()
export class PayoutProviderRegistry {
  private readonly providers = new Map<string, PayoutProvider>();

  constructor(
    @Inject(FakePayoutProvider) private readonly fakeProvider: FakePayoutProvider,
    @Inject(ManualPayoutProvider) private readonly manualProvider: ManualPayoutProvider,
  ) {
    this.register(this.fakeProvider);
    this.register(this.manualProvider);
  }

  register(provider: PayoutProvider): void {
    if (!provider || !provider.name) return;
    this.providers.set(provider.name, provider);
  }

  get(name: string): PayoutProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new SettlementDomainError(
        "PAYOUT_PROVIDER_NOT_ALLOWED",
        `درگاه تسویه ناشناخته است: ${name}`,
        400,
      );
    }
    return provider;
  }
}
