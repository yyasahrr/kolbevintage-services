/**
 * Phase 5.8 — Retail compat-proxy translation helpers (Next edge).
 *
 * Canonical pricing now lives in Nest `RetailPricingService`, and canonical
 * checkout in Nest `RetailOrdersService`. This module is NOT a pricing
 * authority and NOT a writer: it only translates the frozen legacy
 * storefront body to the canonical Nest DTO, and the Nest response/error
 * back to the frozen legacy shape.
 *
 * Deleted in 5.8-A (no second authority may survive): `priceRetailOrder`,
 * the TS-catalog price book, `PRICE_BOOK_VERSION`, `SHIPPING_METHODS`,
 * `FREE_SHIPPING_THRESHOLD`, `paymentSettlementStatus`,
 * `requiresPaymentProvider`, `parseCustomerContact`, `parseDeliveryAddress`.
 * Browser money (`totals`, `shipping.price`, line `price`) is never
 * forwarded and never trusted; `adjusted` is derived by comparing the
 * browser's display hints against Nest-resolved unit prices.
 */

import { randomUUID } from "node:crypto";
import { HttpError } from "./http-error";

/**
 * روش‌های پرداخت خرده‌فروشی.
 *
 * ⚠️ قاعدهٔ حاکم: **BNPL فقط برای خرده‌فروشی است** (`installment`).
 * عمده‌فروشی/VIP حق استفاده از این روش را ندارد. این ثابت‌ها سیاست کانال‌اند،
 * نه مرجع قیمت؛ اعتبارسنجی واقعی در Nest انجام می‌شود.
 */
export const RETAIL_PAYMENT_METHODS = ["gateway", "installment", "cod", "wallet"] as const;
export type RetailPaymentMethod = (typeof RETAIL_PAYMENT_METHODS)[number];

export const WHOLESALE_PAYMENT_METHODS = ["gateway", "transfer", "credit"] as const;

export function assertPaymentMethodAllowed(
  channel: "retail" | "wholesale",
  method: string,
): asserts method is RetailPaymentMethod {
  const allowed: readonly string[] =
    channel === "retail" ? RETAIL_PAYMENT_METHODS : WHOLESALE_PAYMENT_METHODS;
  if (!allowed.includes(method)) {
    throw new HttpError(422, "PAYMENT_METHOD_NOT_ALLOWED");
  }
}

/**
 * روش‌هایی که برای وصول مبلغ به یک ارائه‌دهندهٔ بیرونی (درگاه/BNPL/کیف پول)
 * نیاز دارند. `cod` تنها روشی است که بدون ارائه‌دهنده کامل می‌شود.
 * (فقط برای سازگاری قرارداد پاسخ؛ وضعیت واقعی را Nest اعلام می‌کند.)
 */
export const PROVIDER_BACKED_PAYMENT_METHODS: readonly RetailPaymentMethod[] = [
  "gateway",
  "installment",
  "wallet",
];

/** قلم سفارش در قرارداد قدیمی فروشگاه (فقط `id`+`qty` ورودی مرجع‌اند؛ بقیه hint نمایشی). */
export type LegacyRetailLine = {
  id?: unknown;
  name?: unknown;
  colour?: unknown;
  size?: unknown;
  price?: unknown;
  qty?: unknown;
  img?: unknown;
};

export type NestRetailOrderRequest = {
  customer: { name?: unknown; phone?: unknown; email?: unknown };
  lines: Array<{
    productId?: unknown;
    quantity?: unknown;
    colour?: unknown;
    size?: unknown;
    presentedName?: unknown;
    presentedUnitPrice?: unknown;
  }>;
  address?: unknown;
  shippingMethodId?: unknown;
  payMethod?: unknown;
  couponCodes?: string[];
  acceptedPolicyDocumentIds?: string[];
  idempotencyKey: string;
};

function stringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.filter((entry): entry is string => typeof entry === "string").slice(0, max);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * ترجمهٔ بدنهٔ قدیمی فروشگاه به DTO canonical نست.
 * پول مرورگر (`totals`، `shipping.price`، `price` هر قلم) هیچ‌وقت فوروارد نمی‌شود؛
 * `price` فقط به‌عنوان hint نمایشی (`presentedUnitPrice`) برای پرچم `adjusted` می‌رود.
 */
export function translateRetailOrderToNest(body: any, idempotencyKey: string): NestRetailOrderRequest {
  const source = body && typeof body === "object" ? body : {};
  const rawLines = Array.isArray(source.lines) ? source.lines : [];
  const address = source.address && typeof source.address === "object" ? source.address : undefined;
  return {
    customer: {
      name: source.customer?.name,
      phone: source.customer?.phone,
      email: source.customer?.email,
    },
    lines: rawLines.map((line: LegacyRetailLine) => ({
      productId: line?.id,
      quantity: line?.qty,
      colour: line?.colour,
      size: line?.size,
      presentedName: line?.name,
      presentedUnitPrice: line?.price,
    })),
    address: address
      ? {
          province: address.province,
          city: address.city,
          address: address.address,
          plaque: address.plaque,
          unit: address.unit,
          postal: address.postal,
          note: address.note,
        }
      : undefined,
    // Legacy default preserved: an omitted payMethod meant gateway.
    shippingMethodId: source.shipping?.id ?? source.shippingMethodId,
    payMethod: source.payMethod ?? source.paymentMethod ?? "gateway",
    couponCodes: stringArray(source.couponCodes, 20),
    acceptedPolicyDocumentIds: stringArray(source.acceptedPolicyDocumentIds, 20),
    idempotencyKey,
  };
}

/**
 * کلید idempotency لبهٔ سازگاری: قرارداد قدیمی آن را اختیاری می‌دانست، اما
 * Nest آن را الزامی می‌کند؛ پس در غیاب کلاینت، سرور یکی می‌سازد (رفتار
 * «یک‌بار، بدون idempotency» معادل حالت قدیمی `NULL`).
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveRetailIdempotencyKey(headerValue: string | null): string {
  if (!headerValue) {
    return `rt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  }
  const key = headerValue.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new HttpError(422, "INVALID_IDEMPOTENCY_KEY");
  }
  return key;
}

export type NestRetailOrderResponse = {
  orderCode: string;
  status: string;
  replayed: boolean;
  currency: string;
  totals: { itemsTotal: string; shippingTotal: string; grandTotal: string };
  lines: Array<{ productId: string; unitPrice: string; colour: string | null; size: string | null }>;
  payment: { method: string; status: string; collected: boolean; requiresManualSettlement: boolean };
};

export type LegacyRetailOrderResponse = {
  orderCode: string;
  status: string;
  replayed: boolean;
  currency: string;
  totals: { items: number; shipping: number; total: number };
  adjusted: boolean;
  payment: { method: string; status: string; collected: boolean; requiresManualSettlement: boolean };
};

/**
 * پرچم سازگاری `adjusted`: آیا hint نمایشی مرورگر با حقیقت سرور فرق داشت؟
 * تطبیق هر قلم ارسالی با قلم حل‌شدهٔ Nest از روی شناسه+ویژگی انجام می‌شود
 * (نه ایندکس آرایه، چون ترتیب ردیف‌ها تضمین قراردادی نیست).
 */
function deriveAdjusted(submitted: LegacyRetailLine[], resolved: NestRetailOrderResponse["lines"]): boolean {
  if (resolved.length !== submitted.length) return true;
  const used = new Array(resolved.length).fill(false);
  for (const line of submitted) {
    const id = typeof line?.id === "string" ? line.id.trim() : "";
    const size = typeof line?.size === "string" ? line.size.trim().toLowerCase() : "";
    const colour = typeof line?.colour === "string" ? line.colour.trim().toLowerCase() : "";
    let match = -1;
    for (let i = 0; i < resolved.length; i++) {
      if (used[i]) continue;
      const candidate = resolved[i];
      if (id && candidate.productId !== id) continue;
      if (size && (candidate.size ?? "").toLowerCase() !== size) continue;
      if (colour && (candidate.colour ?? "").toLowerCase() !== colour) continue;
      match = i;
      break;
    }
    if (match === -1) return true;
    used[match] = true;
    const submittedPrice = line?.price;
    if (typeof submittedPrice === "number" && Number.isFinite(submittedPrice)) {
      try {
        if (BigInt(Math.trunc(submittedPrice)) !== BigInt(resolved[match].unitPrice)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

/** ترجمهٔ پاسخ canonical نست به شکل قدیمی منجمد فروشگاه. */
export function translateRetailOrderFromNest(
  data: any,
  submittedLines: LegacyRetailLine[],
): { body: LegacyRetailOrderResponse; status: number } {
  const orderCode = typeof data?.orderCode === "string" ? data.orderCode : "";
  const totals = data?.totals;
  const payment = data?.payment;
  if (!orderCode || !totals || !payment || !Array.isArray(data?.lines)) {
    throw new HttpError(502, "RETAIL_UPSTREAM_INVALID");
  }
  const replayed = data.replayed === true;
  return {
    body: {
      orderCode,
      status: typeof data.status === "string" ? data.status : "placed",
      replayed,
      currency: typeof data.currency === "string" ? data.currency : "IRR",
      totals: {
        items: Number(totals.itemsTotal),
        shipping: Number(totals.shippingTotal),
        total: Number(totals.grandTotal),
      },
      adjusted: deriveAdjusted(submittedLines, data.lines),
      payment: {
        method: String(payment.method ?? ""),
        status: String(payment.status ?? ""),
        collected: payment.collected === true,
        requiresManualSettlement: payment.requiresManualSettlement === true,
      },
    },
    status: replayed ? 200 : 201,
  };
}

/**
 * نگاشت خطای Nest به کدهای قدیمی منجمد (قرارداد پاسخ بدون تغییر می‌ماند؛
 * کدهایی که معادل قدیمی ندارند — تعارض idempotency، پروموشن، موجودی، حقوقی —
 * با وضعیت و کد خود Nest منتقل می‌شوند چون سطح عمومی جدید و صادق‌اند).
 */
export const RETAIL_NEST_ERROR_MAP: Record<string, { status: number; code: string }> = {
  RETAIL_CUSTOMER_NAME_REQUIRED: { status: 422, code: "CUSTOMER_NAME_REQUIRED" },
  RETAIL_CUSTOMER_PHONE_INVALID: { status: 422, code: "CUSTOMER_PHONE_INVALID" },
  RETAIL_CUSTOMER_EMAIL_INVALID: { status: 422, code: "CUSTOMER_EMAIL_INVALID" },
  RETAIL_ADDRESS_INCOMPLETE: { status: 422, code: "ADDRESS_INCOMPLETE" },
  RETAIL_LINES_REQUIRED: { status: 422, code: "EMPTY_CART" },
  RETAIL_TOO_MANY_LINES: { status: 422, code: "TOO_MANY_LINES" },
  RETAIL_LINE_PRODUCT_REQUIRED: { status: 422, code: "LINE_PRODUCT_REQUIRED" },
  RETAIL_QUANTITY_INVALID: { status: 422, code: "INVALID_QUANTITY" },
  RETAIL_PRODUCT_NOT_FOUND: { status: 422, code: "PRODUCT_UNAVAILABLE" },
  RETAIL_PRODUCT_NOT_KOLBE: { status: 422, code: "PRODUCT_UNAVAILABLE" },
  RETAIL_PRODUCT_NOT_PUBLISHED: { status: 422, code: "PRODUCT_UNAVAILABLE" },
  RETAIL_VARIANT_NOT_FOUND: { status: 422, code: "SIZE_UNAVAILABLE" },
  RETAIL_VARIANT_MISMATCH: { status: 422, code: "SIZE_UNAVAILABLE" },
  RETAIL_VARIANT_INACTIVE: { status: 422, code: "SIZE_UNAVAILABLE" },
  RETAIL_VARIANT_UNRESOLVED: { status: 422, code: "SIZE_UNAVAILABLE" },
  RETAIL_VARIANT_AMBIGUOUS: { status: 422, code: "SIZE_UNAVAILABLE" },
  RETAIL_OFFER_MISSING: { status: 422, code: "PRODUCT_UNAVAILABLE" },
  RETAIL_OFFER_AMBIGUOUS: { status: 422, code: "PRODUCT_UNAVAILABLE" },
  RETAIL_SHIPPING_METHOD_INVALID: { status: 422, code: "INVALID_SHIPPING_METHOD" },
  RETAIL_PAYMENT_METHOD_INVALID: { status: 422, code: "PAYMENT_METHOD_NOT_ALLOWED" },
  RETAIL_IDEMPOTENCY_KEY_REQUIRED: { status: 422, code: "INVALID_IDEMPOTENCY_KEY" },
  RETAIL_IDEMPOTENCY_KEY_INVALID: { status: 422, code: "INVALID_IDEMPOTENCY_KEY" },
};

export function translateRetailNestError(status: number, data: any): HttpError {
  const code =
    typeof data?.error === "string" ? data.error : typeof data?.code === "string" ? data.code : null;
  const mapped = code ? RETAIL_NEST_ERROR_MAP[code] : undefined;
  if (mapped) return new HttpError(mapped.status, mapped.code);
  if (code) {
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    return new HttpError(safeStatus, code);
  }
  return new HttpError(502, "RETAIL_UPSTREAM_INVALID");
}
