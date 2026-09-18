/**
 * مرجع قیمت خرده‌فروشی — سمت سرور (Single Source of Truth).
 *
 * چرا این فایل وجود دارد؟
 * ممیزی معماری (docs/architecture-audit-and-migration-blueprint.md، ایراد D3) نشان داد که
 * قیمت و جمع کل سفارش خرده‌فروشی صرفاً از سمت مرورگر گرفته و بدون بازبینی ذخیره می‌شد؛
 * یعنی هر کاربری می‌توانست `price` یا `totals.total` را دستکاری کند (Price Tampering).
 *
 * قاعده حاکم (PROMPT 0): «Frontend never connects directly to PostgreSQL» و
 * «All sensitive operations go through NestJS» و «monetary values must not be floats».
 * پس قیمت‌گذاری باید در لبه سرور انجام شود، با اعداد صحیح (bigint) و نه اعشاری.
 *
 * ⚠️ وضعیت موقت (بدهی فنی ثبت‌شده — D7):
 * کاتالوگ خرده‌فروشی امروز در `storefront/data/catalog.ts` هاردکد شده و نسخهٔ قابل ویرایش
 * آن در localStorage مرورگر مدیر زندگی می‌کند. این فایل همان کاتالوگ را به‌عنوان
 * «مرجع قیمت مرحلهٔ گذار» می‌خواند تا سرور بتواند قیمت را بازمحاسبه کند.
 * در فاز ۳ نقشهٔ مهاجرت، این ماژول با جدول‌های `products` / `offers` / `pricing`
 * جایگزین می‌شود و تنها نقطهٔ تعویض، همین فایل است. هیچ ماژول دیگری نباید
 * قیمت را از خودش استخراج کند.
 */

import { createHash } from "node:crypto";
import { products } from "@/data/catalog";
import { HttpError } from "./http-error";

/** روش‌های ارسال و هزینهٔ آن‌ها به ریال. مرجع: صفحهٔ Checkout. */
export const SHIPPING_METHODS = [
  { id: "post", label: "پست عادی", price: 59_000n },
  { id: "pishtaz", label: "پست پیشتاز", price: 89_000n },
  { id: "tipax", label: "تیپاکس", price: 145_000n },
] as const;

export type ShippingMethodId = (typeof SHIPPING_METHODS)[number]["id"];

/** سفارش بالای این مبلغ ارسال رایگان دارد. */
export const FREE_SHIPPING_THRESHOLD = 3_000_000n;

/**
 * روش‌های پرداخت خرده‌فروشی.
 *
 * ⚠️ قاعدهٔ حاکم: **BNPL فقط برای خرده‌فروشی است** (`installment`).
 * عمده‌فروشی/VIP حق استفاده از این روش را ندارد؛ این محدودیت در
 * `retailOnlyPaymentMethods` و نگهبان `assertPaymentMethodAllowed` کدگذاری شده
 * تا در فاز پرداخت (۵) به ماژول `payments` منتقل شود.
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
 */
export const PROVIDER_BACKED_PAYMENT_METHODS: readonly RetailPaymentMethod[] = [
  "gateway",
  "installment",
  "wallet",
];

/**
 * وضعیت پرداخت که در `retail_order.payment_status` ثبت می‌شود.
 *
 * ── اصلاح D19a (فاز ۱.۵) ────────────────────────────────────────────────────
 * پیش از این، هر سفارش غیرِ COD وضعیت `pending_gateway` می‌گرفت — یعنی
 * «منتظر درگاه بانکی». اما **هیچ ارائه‌دهندهٔ پرداختی وجود ندارد** (نه درگاه، نه
 * SnappPay/DigiPay، نه کیف پول؛ دامنهٔ `payments` فاز ۵ است). نتیجه این بود که
 * سیستم ادعای وصول پول می‌کرد در حالی که هیچ پولی هرگز وصول نمی‌شد و هیچ
 * ردی برای تطبیق مالی وجود نداشت (یافتهٔ BLOCKER ممیزی: D19).
 *
 * حالا وضعیت، واقعیت را می‌گوید:
 *   • `pending_cod`  → پرداخت هنگام تحویل؛ روشی که واقعاً کار می‌کند.
 *   • `unpaid`       → روشی که به ارائه‌دهنده نیاز دارد و ارائه‌دهنده‌ای وجود ندارد.
 *
 * ⚠️ چرا روش‌ها حذف/رد نشدند: ممیزی دو گزینه داشت («فقط COD» یا «ثبت
 * `payment_pending`»). گزینهٔ نخست آزمون شد و رد شد، چون قاعدهٔ موجود
 * «COD ⇒ هزینهٔ ارسال صفر» باعث می‌شد با COD-تنها **هیچ سفارشی هزینهٔ ارسال
 * نپردازد** (درآمد ارسال صفر) و سفارش از استان‌های خارج از محدودهٔ COD هم
 * ممکن نباشد. پس روش‌ها باقی می‌مانند، اما وضعیتشان صادق است و UI هم همین را
 * به مشتری نشان می‌دهد (پیام «پرداخت آنلاین به‌زودی» + هماهنگی پرداخت).
 *
 * در فاز ۵ که ماژول `payments` ساخته شد، این تابع به آن ماژول منتقل می‌شود و
 * مقدار `pending_gateway` تنها با وجود واقعی یک ارائه‌دهنده برگردانده می‌شود.
 */
export function paymentSettlementStatus(method: RetailPaymentMethod): string {
  return method === "cod" ? "pending_cod" : "unpaid";
}

/** آیا این روش به ارائه‌دهندهٔ پرداخت نیاز دارد؟ (برای گزارش و پیام UI) */
export function requiresPaymentProvider(method: RetailPaymentMethod): boolean {
  return PROVIDER_BACKED_PAYMENT_METHODS.includes(method);
}

type PriceEntry = {
  productId: string;
  sku: string;
  name: string;
  unitPrice: bigint;
  sizes: string[];
  colours: string[];
};

function buildPriceBook(): Map<string, PriceEntry> {
  const book = new Map<string, PriceEntry>();
  for (const product of products) {
    const entry: PriceEntry = {
      productId: product.id,
      sku: product.specs?.code ?? product.id,
      name: product.name,
      // قیمت کاتالوگ عدد صحیح ریال است؛ تبدیل صریح به bigint مانع هرگونه محاسبهٔ اعشاری می‌شود.
      unitPrice: BigInt(Math.trunc(product.price)),
      sizes: product.sizes.map((size) => size.label),
      colours: product.colours.map((colour) => colour.name),
    };
    book.set(product.id, entry);
    if (entry.sku) book.set(entry.sku, entry);
  }
  return book;
}

const priceBook = buildPriceBook();

/**
 * نسخهٔ مرجع قیمت. در هر سفارش ذخیره می‌شود تا بعداً معلوم باشد سفارش با کدام
 * نسخهٔ قیمت قیمت‌گذاری شده است (قاعدهٔ «تاریخ نباید با تغییر تنظیمات عوض شود»).
 */
export const PRICE_BOOK_VERSION = createHash("sha256")
  .update(
    JSON.stringify(
      [...priceBook.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, entry.unitPrice.toString()]),
    ),
  )
  .digest("hex")
  .slice(0, 16);

export type RetailLineRequest = {
  id?: unknown;
  name?: unknown;
  colour?: unknown;
  size?: unknown;
  price?: unknown;
  qty?: unknown;
  img?: unknown;
};

export type PricedRetailLine = {
  productId: string;
  sku: string;
  productName: string;
  colour: string | null;
  size: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: bigint;
  lineTotal: bigint;
  /** اگر قیمت ارسالی مرورگر با مرجع سرور یکی نبود، اینجا ثبت می‌شود (برای گزارش/هشدار). */
  submittedUnitPrice: bigint | null;
};

export type PricedRetailOrder = {
  lines: PricedRetailLine[];
  itemsTotal: bigint;
  shippingTotal: bigint;
  grandTotal: bigint;
  shippingMethod: ShippingMethodId;
  paymentMethod: RetailPaymentMethod;
  paymentStatus: string;
  /**
   * آیا مبلغی در همین لحظه وصول شده است؟ تا فاز ۵ همیشه `false` است و
   * عمداً در پاسخ API برمی‌گردد تا هیچ کلاینتی نتواند «پرداخت‌شده» فرض کند.
   */
  paymentCollected: boolean;
  /** روشی که ارائه‌دهنده ندارد و وصول آن نیازمند هماهنگی دستی/فاز ۵ است. */
  requiresManualSettlement: boolean;
  /** آدرس‌های ناموجودی که مرورگر فرستاده بود و سرور اصلاح کرد. */
  adjusted: boolean;
  priceBookVersion: string;
};

export const MAX_LINES = 50;
export const MAX_QUANTITY_PER_LINE = 100;

function positiveInteger(value: unknown, code: string, max: number): number {
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > max) {
    throw new HttpError(422, code);
  }
  return quantity;
}

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function resolveShippingMethod(id: unknown): (typeof SHIPPING_METHODS)[number] {
  const method = SHIPPING_METHODS.find((candidate) => candidate.id === id);
  if (!method) throw new HttpError(422, "INVALID_SHIPPING_METHOD");
  return method;
}

/**
 * قیمت‌گذاری سرور برای یک سفارش خرده‌فروشی.
 *
 * - قیمت هر قلم از مرجع سرور خوانده می‌شود، نه از مرورگر.
 * - جمع‌ها با bigint و اعداد صحیح محاسبه می‌شوند (بدون خطای اعشاری).
 * - قلم ناموجود (محصول/سایز نامعتبر) باعث رد سفارش می‌شود.
 */
export function priceRetailOrder(
  rawLines: unknown,
  options: { shippingMethodId?: unknown; paymentMethod?: unknown },
): PricedRetailOrder {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpError(422, "EMPTY_CART");
  }
  if (rawLines.length > MAX_LINES) {
    throw new HttpError(422, "TOO_MANY_LINES");
  }

  const paymentMethodRaw = text(options.paymentMethod, 32) || "gateway";
  assertPaymentMethodAllowed("retail", paymentMethodRaw);
  const paymentMethod = paymentMethodRaw as RetailPaymentMethod;
  const shippingMethod = resolveShippingMethod(options.shippingMethodId);

  const lines: PricedRetailLine[] = [];
  let itemsTotal = 0n;
  let adjusted = false;

  for (const raw of rawLines as RetailLineRequest[]) {
    const productId = text(raw?.id, 128);
    if (!productId) throw new HttpError(422, "LINE_PRODUCT_REQUIRED");

    const entry = priceBook.get(productId);
    if (!entry) throw new HttpError(422, "PRODUCT_UNAVAILABLE");

    const quantity = positiveInteger(raw?.qty, "INVALID_QUANTITY", MAX_QUANTITY_PER_LINE);

    // سایز بخشی از هویت قلم سفارش است؛ سایز ناشناخته باید رد شود.
    const size = text(raw?.size, 32) || null;
    if (size && !entry.sizes.includes(size)) throw new HttpError(422, "SIZE_UNAVAILABLE");

    const colour = text(raw?.colour, 64) || null;
    if (colour && !entry.colours.includes(colour)) adjusted = true;

    const submittedUnitPrice =
      typeof raw?.price === "number" && Number.isFinite(raw.price)
        ? BigInt(Math.trunc(raw.price))
        : null;
    if (submittedUnitPrice !== null && submittedUnitPrice !== entry.unitPrice) adjusted = true;

    const lineTotal = entry.unitPrice * BigInt(quantity);
    itemsTotal += lineTotal;

    lines.push({
      productId: entry.productId,
      sku: entry.sku,
      productName: entry.name,
      colour,
      size,
      imageUrl: text(raw?.img, 512) || null,
      quantity,
      unitPrice: entry.unitPrice,
      lineTotal,
      submittedUnitPrice,
    });
  }

  const shippingTotal =
    paymentMethod === "cod" || itemsTotal >= FREE_SHIPPING_THRESHOLD || itemsTotal === 0n
      ? 0n
      : shippingMethod.price;

  return {
    lines,
    itemsTotal,
    shippingTotal,
    grandTotal: itemsTotal + shippingTotal,
    shippingMethod: shippingMethod.id,
    paymentMethod,
    paymentStatus: paymentSettlementStatus(paymentMethod),
    paymentCollected: false,
    requiresManualSettlement: requiresPaymentProvider(paymentMethod),
    adjusted,
    priceBookVersion: PRICE_BOOK_VERSION,
  };
}

export type CustomerContact = { name: string; phone: string; email: string | null };

export function parseCustomerContact(input: any): CustomerContact {
  const name = text(input?.name, 160);
  const phone = text(input?.phone, 32);
  const email = text(input?.email, 254) || null;
  if (!name) throw new HttpError(422, "CUSTOMER_NAME_REQUIRED");
  // شمارهٔ موبایل ایران: 09xxxxxxxxx یا +989xxxxxxxxx یا 9xxxxxxxxx
  const normalizedPhone = phone.replace(/[\s-]/g, "");
  if (!/^(?:\+98|0098|98|0)?9\d{9}$/.test(normalizedPhone)) {
    throw new HttpError(422, "CUSTOMER_PHONE_INVALID");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new HttpError(422, "CUSTOMER_EMAIL_INVALID");
  }
  return { name: name.slice(0, 160), phone: normalizedPhone, email };
}

/** آدرس تحویل؛ فقط کلیدهای شناخته‌شده ذخیره می‌شوند تا بدنهٔ دلخواه در دیتابیس ننشیند. */
export function parseDeliveryAddress(input: any) {
  const field = (key: string, maxLength: number) => text(input?.[key], maxLength);
  const province = field("province", 64);
  const city = field("city", 64);
  const address = field("address", 512);
  if (!province || !city || !address) throw new HttpError(422, "ADDRESS_INCOMPLETE");
  return {
    province,
    city,
    address,
    plaque: field("plaque", 16),
    unit: field("unit", 16),
    postal: field("postal", 16).replace(/\D/g, "").slice(0, 10),
    note: field("note", 512),
  };
}

/** خروجی JSON — مبالغ به‌صورت رشته تا در JSON به float تبدیل نشوند. */
export function moneyToJson(value: bigint): string {
  return value.toString();
}
