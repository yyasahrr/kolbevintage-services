import { Injectable } from "@nestjs/common";
import { resolvePrice, type PriceResolutionInput, type PriceResolutionOutput } from "./pricing.logic";

/**
 * PricingService — tableless domain, uses Offers public query contracts
 * Authoritative server-side price resolution, no owned tables
 */
@Injectable()
export class PricingService {
  resolvePrice(input: PriceResolutionInput): PriceResolutionOutput {
    return resolvePrice(input);
  }
}
