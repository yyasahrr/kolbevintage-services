import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { SHIPPING_METHOD_IDS } from "@kolbe/database";
import { MAX_MONEY, RETAIL_SHIPPING_RULES } from "@kolbe/shared";
export { RETAIL_SHIPPING_RULES };
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { CatalogService } from "../catalog/catalog.service";
import { OffersService } from "../offers/offers.service";
import { RETAIL_PRICING_RESOLVER } from "../promotions/promotions.contract";
import { RetailDomainError, type RetailLineInput } from "../orders/retail/retail-orders.contract";

/**
 * Phase 5.8 — canonical Retail pricing authority (Nest).
 *
 * Replaces `frontend-next/server/retail-pricing.ts`, which priced from a
 * hardcoded TS catalog. Every line resolves from canonical truth:
 * product (KOLBE + published) → variant (explicit id, or unique match on
 * size/colour attributes) → KOLBE seller offer (`retail_price`, approved
 * or published). Browser-submitted names, prices, and eligibility are
 * never authority; optional `presented*` fields exist only to compute the
 * `adjusted` honesty flag.
 *
 * Deterministic: same inputs + same committed catalog rows → same outputs
 * (no clock, no randomness). Reads thread the caller's executor so
 * checkout sees one repeatable snapshot.
 */

export type ResolvedRetailLine = {
  lineId: string;
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  colour: string | null;
  size: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: bigint;
  baseLineTotal: bigint;
  offerId: string;
};

export type RetailPriceResolution = {
  lines: ResolvedRetailLine[];
  itemsTotal: bigint;
  shippingTotal: bigint;
  prePromoGrandTotal: bigint;
  shippingMethod: string;
  /** Authority version pinned on the order (`price_book_version`). */
  version: string;
  adjusted: boolean;
};

/**
 * Retail shipping rules live in `@kolbe/shared` since Checkpoint C so
 * Pricing and Shipping read the same server table. Re-exported here so
 * existing import sites (and the pricing authority hash) keep working
 * unchanged; values are byte-identical to the legacy ones.
 */

export const RETAIL_MAX_LINES = 50;
export const RETAIL_MAX_QUANTITY_PER_LINE = 100;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normAttr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

/** Case-insensitive attribute lookup: variant JSON keys are not normalized. */
function attrOf(attributes: unknown, keys: string[]): string | null {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return null;
  const lowered = new Map<string, unknown>();
  for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
    lowered.set(key.toLowerCase(), value);
  }
  for (const key of keys) {
    const hit = normAttr(lowered.get(key));
    if (hit) return hit;
  }
  return null;
}

@Injectable()
export class RetailPricingService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OffersService) private readonly offers: OffersService,
  ) {}

  async resolveCheckoutPricing(
    input: {
      lines: RetailLineInput[];
      shippingMethodId: unknown;
      /** Caller-derived from payMethod === "cod": the preserved D19a coupling. */
      freeShippingOverride: boolean;
      executor?: any;
    },
  ): Promise<RetailPriceResolution> {
    const executor = input.executor ?? this.db;
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new RetailDomainError("RETAIL_LINES_REQUIRED", "at least one order line is required");
    }
    if (input.lines.length > RETAIL_MAX_LINES) {
      throw new RetailDomainError("RETAIL_TOO_MANY_LINES", `at most ${RETAIL_MAX_LINES} lines per order`);
    }
    const shippingMethod = asText(input.shippingMethodId);
    if (!(SHIPPING_METHOD_IDS as readonly string[]).includes(shippingMethod)) {
      throw new RetailDomainError("RETAIL_SHIPPING_METHOD_INVALID", "unknown shipping method");
    }

    const sellerId = await this.offers.ensureSeller(null, "KOLBE");
    const lines: ResolvedRetailLine[] = [];
    let adjusted = false;
    for (let index = 0; index < input.lines.length; index++) {
      const resolved = await this.resolveLine(input.lines[index], index, sellerId, executor);
      lines.push(resolved.line);
      adjusted = adjusted || resolved.adjusted;
    }

    let itemsTotal = 0n;
    for (const line of lines) itemsTotal += line.baseLineTotal;
    const shippingTotal =
      input.freeShippingOverride || itemsTotal >= RETAIL_SHIPPING_RULES.freeThreshold || itemsTotal === 0n
        ? 0n
        : RETAIL_SHIPPING_RULES.methods[shippingMethod];
    const prePromoGrandTotal = itemsTotal + shippingTotal;
    if (prePromoGrandTotal > MAX_MONEY) {
      throw new RetailDomainError("RETAIL_MONETARY_OVERFLOW", "order total exceeds the monetary ceiling");
    }
    return {
      lines,
      itemsTotal,
      shippingTotal,
      prePromoGrandTotal,
      shippingMethod,
      version: this.authorityVersion(lines, shippingMethod),
      adjusted,
    };
  }

  private authorityVersion(lines: ResolvedRetailLine[], shippingMethod: string): string {
    const canonical = JSON.stringify({
      v: 1,
      resolver: RETAIL_PRICING_RESOLVER,
      ship: {
        rules: RETAIL_SHIPPING_RULES.version,
        method: shippingMethod,
        threshold: RETAIL_SHIPPING_RULES.freeThreshold.toString(),
      },
      lines: lines.map((line) => [line.productId, line.variantId, line.offerId, line.quantity, line.unitPrice.toString()]),
    });
    return `rpv1.${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
  }

  private async resolveLine(
    raw: RetailLineInput,
    index: number,
    sellerId: string,
    executor: any,
  ): Promise<{ line: ResolvedRetailLine; adjusted: boolean }> {
    const productId = asText(raw?.productId);
    if (!productId) throw new RetailDomainError("RETAIL_LINE_PRODUCT_REQUIRED", `line ${index}: productId is required`);

    const quantity = typeof raw?.quantity === "number" ? raw.quantity : Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > RETAIL_MAX_QUANTITY_PER_LINE) {
      throw new RetailDomainError("RETAIL_QUANTITY_INVALID", `line ${index}: quantity must be 1..${RETAIL_MAX_QUANTITY_PER_LINE}`);
    }

    const prod = await this.catalog.findProductForRetail(productId, executor);
    if (!prod) throw new RetailDomainError("RETAIL_PRODUCT_NOT_FOUND", `line ${index}: product not found`);
    if (prod.ownerType !== "KOLBE") {
      throw new RetailDomainError("RETAIL_PRODUCT_NOT_KOLBE", `line ${index}: retail sells KOLBE products only`);
    }
    if (prod.status !== "published") {
      throw new RetailDomainError("RETAIL_PRODUCT_NOT_PUBLISHED", `line ${index}: product is not published (status: ${prod.status})`);
    }

    const variant = await this.resolveVariant(raw, index, productId, executor);
    const candidates = await this.offers.getRetailOfferCandidates({ productId, variantId: variant.id, sellerId }, executor);
    const scoped = candidates.filter((row: any) => row.variantId === variant.id);
    const pool = scoped.length > 0 ? scoped : candidates.filter((row: any) => row.variantId === null);
    if (pool.length === 0) {
      throw new RetailDomainError("RETAIL_OFFER_MISSING", `line ${index}: no live KOLBE retail offer with a price`);
    }
    if (pool.length > 1) {
      throw new RetailDomainError("RETAIL_OFFER_AMBIGUOUS", `line ${index}: multiple live KOLBE retail offers`);
    }
    const offer = pool[0] as { id: string; retailPrice: bigint | null };
    const unitPrice = offer.retailPrice as bigint;
    if (typeof unitPrice !== "bigint" || unitPrice <= 0n || unitPrice > MAX_MONEY) {
      throw new RetailDomainError("RETAIL_MONETARY_OVERFLOW", `line ${index}: unit price outside the monetary range`);
    }
    const baseLineTotal = unitPrice * BigInt(quantity);
    if (baseLineTotal > MAX_MONEY) {
      throw new RetailDomainError("RETAIL_MONETARY_OVERFLOW", `line ${index}: line total exceeds the monetary ceiling`);
    }

    const attributes = (variant.attributes ?? {}) as Record<string, unknown>;
    const attrEntries = new Map<string, unknown>();
    for (const [key, value] of Object.entries(attributes)) attrEntries.set(key.toLowerCase(), value);
    const originalOf = (keys: string[]): string | null => {
      for (const key of keys) {
        const value = attrEntries.get(key);
        if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 64);
      }
      return null;
    };

    let adjusted = false;
    const presentedPrice = raw?.presentedUnitPrice;
    if (presentedPrice !== undefined && presentedPrice !== null && String(presentedPrice).trim() !== "") {
      try {
        if (BigInt(String(presentedPrice).trim()) !== unitPrice) adjusted = true;
      } catch {
        adjusted = true;
      }
    }
    const presentedName = asText(raw?.presentedName);
    if (presentedName !== "" && presentedName !== prod.name) adjusted = true;

    return {
      line: {
        lineId: `l${index}`,
        productId,
        variantId: variant.id,
        sku: variant.sku,
        productName: prod.name,
        colour: originalOf(["colour", "color"]),
        size: originalOf(["size"]),
        imageUrl: await this.catalog.getPrimaryMedia(productId, variant.id, executor),
        quantity,
        unitPrice,
        baseLineTotal,
        offerId: offer.id,
      },
      adjusted,
    };
  }

  private async resolveVariant(raw: RetailLineInput, index: number, productId: string, executor: any) {
    const explicitId = asText(raw?.variantId);
    if (explicitId !== "") {
      const variant = await this.catalog.findVariantById(explicitId, executor);
      if (!variant) throw new RetailDomainError("RETAIL_VARIANT_NOT_FOUND", `line ${index}: variant not found`);
      if (variant.productId !== productId) {
        throw new RetailDomainError("RETAIL_VARIANT_MISMATCH", `line ${index}: variant does not belong to the product`);
      }
      if (variant.status !== "active") {
        throw new RetailDomainError("RETAIL_VARIANT_INACTIVE", `line ${index}: variant is not active`);
      }
      return variant;
    }
    const wantSize = normAttr(raw?.size);
    const wantColour = normAttr(raw?.colour);
    const actives = await this.catalog.listActiveVariantsForProduct(productId, executor);
    const matches = actives.filter((variant: any) => {
      if (wantSize && attrOf(variant.attributes, ["size"]) !== wantSize) return false;
      if (wantColour && attrOf(variant.attributes, ["colour", "color"]) !== wantColour) return false;
      return true;
    });
    if (matches.length === 0) {
      throw new RetailDomainError("RETAIL_VARIANT_UNRESOLVED", `line ${index}: no active variant matches the requested attributes`);
    }
    if (matches.length > 1) {
      throw new RetailDomainError(
        "RETAIL_VARIANT_AMBIGUOUS",
        `line ${index}: attributes match several variants; specify variantId`,
      );
    }
    return matches[0];
  }
}
