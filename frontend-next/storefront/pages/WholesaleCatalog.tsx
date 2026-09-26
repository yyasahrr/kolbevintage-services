/**
 * کاتالوگ و جزئیاتِ عمده‌فروشی — فاز ۶.۳‑C.
 *
 * این فایل **تنها** سطحِ نمایشِ حقیقتِ تجاریِ کانالِ عمده است. هیچ عددِ تجاری
 * در مرورگر ساخته یا محاسبه نمی‌شود:
 *
 *  - قیمت/پلهٔ قیمت از سرور به‌صورتِ **رشتهٔ اعشاری** می‌آید و همان‌طور نمایش
 *    داده می‌شود (بدونِ `Number`/`parseFloat`/`Math` روی مبلغ).
 *  - MOQ و **واحدِ MOQ** از سرور می‌آید؛ «۲ سری» هرگز به «۲ عدد» تبدیل نمی‌شود.
 *  - موجودی از سرور می‌آید؛ هیچ موجودیِ تخمینی ساخته نمی‌شود.
 *  - دسترسی‌ها از entitlement نشستِ سرور می‌آید، نه از حدسِ مرورگر.
 *
 * سیاستِ طراحی: RESTRUCTURE (ثبت‌شده در truth-registry). ساختارِ پیشین
 * فهرستِ کارت‌های ثابت (`storefront/data/catalog`) با قیمتِ **ساخته‌شدهٔ**
 * `Math.round(price * 0.68 / 10000) * 10000` بود؛ یعنی هم داده ثابت بود و هم
 * مبلغ با محاسبهٔ اعشاریِ مرورگر تولید می‌شد.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiErrorKind } from "../../shared/http/errors";
import type { ApiClient } from "../../shared/http/types";
import type { ApiResult } from "../../shared/http/types";
import {
  fetchWholesaleCatalog,
  fetchWholesaleProductDetail,
  type WholesaleCatalogItem,
  type WholesaleOffer,
  type WholesaleProductDetail,
  type WholesaleSellerType,
} from "../../shared/wholesale/catalog";

/* ── ارائهٔ فارسیِ enumهای دامنه (بدونِ ازبین‌بردنِ معنا) ─────────────────── */

export const MOQ_UNIT_LABELS_FA: Record<string, string> = {
  PIECE: "عدد",
  PACKAGE: "بسته",
  SERIES: "سری",
  BOX: "جعبه",
  CARTON: "کارتن",
  SET: "ست",
};

export const PACKAGE_TYPE_LABELS_FA: Record<string, string> = {
  SIZE_RUN: "سری سایزبندی",
  FIXED_QUANTITY: "تعداد ثابت",
  COLOR_MIX: "ترکیب رنگ",
  CUSTOM_BUNDLE: "بستهٔ دلخواه",
};

export const PRICING_UNIT_LABELS_FA: Record<string, string> = {
  ...MOQ_UNIT_LABELS_FA,
  PER_PIECE: "به ازای هر عدد",
};

export const SELLER_TYPE_LABELS_FA: Record<WholesaleSellerType, string> = {
  KOLBE: "کلبه",
  SUPPLIER: "تأمین‌کننده",
  UNKNOWN: "نامشخص",
};

/**
 * نمایشِ واحدِ MOQ. اگر سرور واحدی بدهد که ما نمی‌شناسیم، همان مقدارِ خام را
 * نشان می‌دهیم تا **هرگز** به «عدد» دروغ نگوییم.
 */
export function moqUnitLabel(unit: string): string {
  return MOQ_UNIT_LABELS_FA[unit] ?? unit;
}

export function packageTypeLabel(type: string): string {
  return PACKAGE_TYPE_LABELS_FA[type] ?? type;
}

export function pricingUnitLabel(unit: string): string {
  return PRICING_UNIT_LABELS_FA[unit] ?? unit;
}

/** «۲ سری» — کمیت و واحد با هم، تا واحد هرگز حذف نشود. */
export function quantityWithUnit(quantity: number, unit: string): string {
  return `${toPersianDigits(quantity)} ${moqUnitLabel(unit)}`;
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/**
 * قالب‌بندیِ مبلغ از روی **رشتهٔ اعشاری**، بدونِ هیچ تبدیل به number.
 * جداکنندهٔ هزارگانِ فارسی (U+066C) استفاده می‌شود.
 */
export function formatMoney(decimalString: string): string {
  const cleaned = decimalString.trim();
  if (!/^\d+$/.test(cleaned)) return cleaned; // اگر قالبِ دیگری بود، دست‌نخورده نشان بده
  const grouped = cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, "\u066C");
  return toPersianDigits(grouped);
}

/* ── وضعیت‌های صریح UI ──────────────────────────────────────────────────── */

export type CatalogViewState =
  | { kind: "LOADING" }
  | { kind: "READY_WITH_DATA" }
  | { kind: "READY_EMPTY" }
  | { kind: "ERROR"; errorKind: ApiErrorKind; message: string };

/**
 * نگاشتِ صریحِ خطای سرور به وضعیتِ UI.
 *
 * ⚠️ خطا هرگز به «خالی» تبدیل نمی‌شود: `READY_EMPTY` فقط وقتی است که سرور
 * موفق پاسخ داده و فهرست واقعاً خالی بوده. `catch { return [] }` در این فایل
 * وجود ندارد.
 */
export function viewStateFromResult(result: ApiResult<unknown>, hasData: boolean): CatalogViewState {
  if (result.ok) return hasData ? { kind: "READY_WITH_DATA" } : { kind: "READY_EMPTY" };
  return { kind: "ERROR", errorKind: result.error.kind, message: result.error.message };
}

const ERROR_COPY_FA: Partial<Record<ApiErrorKind, string>> = {
  UNAUTHORIZED: "برای دیدنِ کاتالوگِ عمده باید وارد شوید.",
  FORBIDDEN: "حساب شما اجازهٔ دسترسی به این بخش را ندارد. این یک محدودیتِ دسترسی است، نه خطای فنی.",
  NOT_FOUND: "موردِ درخواستی پیدا نشد.",
  RATE_LIMITED: "تعدادِ درخواست‌ها زیاد بود؛ کمی بعد دوباره تلاش کنید.",
  SERVER_ERROR: "سرور در پردازشِ درخواست ناموفق بود.",
  NETWORK_ERROR: "اتصال به سرور برقرار نشد. داده‌ای نمایش داده نمی‌شود چون داده‌ای دریافت نشد.",
  PROVIDER_UNAVAILABLE: "سرویسِ وابسته در دسترس نیست.",
  MALFORMED_RESPONSE: "پاسخِ سرور قابل تفسیر نبود.",
};

export function errorCopy(kind: ApiErrorKind, fallback: string): string {
  return ERROR_COPY_FA[kind] ?? fallback;
}

/* ── قطعاتِ مشترکِ ظاهری ─────────────────────────────────────────────────── */

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";

function Money({ value, currency }: { value: string; currency: string }) {
  return (
    <span dir="ltr" className="inline-block unicode-bisolate tabular-nums">
      {formatMoney(value)} <span className="text-[10px] text-neutral-500">{currency}</span>
    </span>
  );
}

function LtrCode({ value }: { value: string }) {
  return <span dir="ltr" className="inline-block unicode-bisolate text-[10.5px] tabular-nums text-neutral-600">{value}</span>;
}

function ErrorPanel({ kind, message, onRetry }: { kind: ApiErrorKind; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="border border-red-200 bg-red-50 p-4">
      <p className="text-[11.5px] font-medium text-red-800">{errorCopy(kind, message)}</p>
      {/* شناسهٔ نوعِ خطا برای رهگیری؛ نه پیامِ خامِ بک‌اند. */}
      <p dir="ltr" className="mt-1 text-[10px] text-red-600">{kind}</p>
      <button type="button" onClick={onRetry} className={`mt-3 border border-red-300 px-3 py-1.5 text-[10.5px] text-red-800 ${RING}`}>
        تلاشِ دوباره
      </button>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" className="border border-dashed border-neutral-300 p-6 text-center">
      <p className="text-[12px] font-medium">{title}</p>
      <p className="mt-1 text-[10.5px] text-neutral-500">{body}</p>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="border border-neutral-200 p-6 text-center text-[11px] text-neutral-500">
      {label}
    </div>
  );
}

/* ── فهرستِ کاتالوگ (صفحه‌بندیِ CURSOR قانونی) ───────────────────────────── */

export function WholesaleCatalogList({
  client,
  onOpen,
  pageSize = 12,
}: {
  client: ApiClient;
  onOpen: (productId: string) => void;
  pageSize?: number;
}) {
  const [items, setItems] = useState<WholesaleCatalogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CatalogViewState>({ kind: "LOADING" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setState({ kind: "LOADING" });
    void (async () => {
      const result = await fetchWholesaleCatalog(client, { limit: pageSize, signal: controller.signal });
      if (id !== requestId.current) return; // پاسخِ قدیمیِ رقابتی نادیده گرفته می‌شود
      if (!result.ok) {
        // خطا هرگز به فهرستِ خالی تبدیل نمی‌شود.
        setState({ kind: "ERROR", errorKind: result.error.kind, message: result.error.message });
        return;
      }
      const page = result.data;
      setItems(page.items as WholesaleCatalogItem[]);
      // `Page` یک اتحاد است؛ `nextCursor` فقط در واریانتِ CURSOR وجود دارد.
      setNextCursor(page.mode === "CURSOR" ? page.nextCursor : null);
      setState(viewStateFromResult(result, page.items.length > 0));
    })();
    return () => controller.abort();
  }, [client, pageSize, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchWholesaleCatalog(client, { limit: pageSize, cursor: nextCursor });
    setLoadingMore(false);
    if (!result.ok) {
      // شکستِ صفحهٔ بعد نباید فهرستِ موجود را پاک کند؛ فقط گزارش می‌شود.
      setState({ kind: "ERROR", errorKind: result.error.kind, message: result.error.message });
      return;
    }
    const page = result.data;
    // جلوگیری از تکرارِ قلم پس از پیمایشِ cursor.
    setItems((current) => {
      const seen = new Set(current.map((item) => item.id));
      return [...current, ...(page.items as WholesaleCatalogItem[]).filter((item) => !seen.has(item.id))];
    });
    setNextCursor(page.mode === "CURSOR" ? page.nextCursor : null);
    setState({ kind: "READY_WITH_DATA" });
  }, [client, loadingMore, nextCursor, pageSize]);

  return (
    <section aria-labelledby="wholesale-catalog-heading" className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wholesale-catalog-heading" className="text-[16px] font-semibold">کاتالوگِ عمده</h2>
        <p className="text-[10.5px] text-neutral-500">قیمت‌ها و موجودی مستقیماً از سرور خوانده می‌شود.</p>
      </header>

      {state.kind === "LOADING" ? <LoadingPanel label="در حالِ خواندنِ کاتالوگ…" /> : null}
      {state.kind === "ERROR" ? (
        <ErrorPanel kind={state.errorKind} message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : null}
      {state.kind === "READY_EMPTY" ? (
        <EmptyPanel title="کاتالوگ خالی است" body="هم‌اکنون محصولِ منتشرشده‌ای در کانالِ عمده وجود ندارد. این یک خطا نیست." />
      ) : null}

      {items.length > 0 ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 border border-neutral-200 bg-[#fffdfa] p-3">
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className={`text-right text-[12.5px] font-medium text-[#0b2a46] underline-offset-4 hover:underline ${RING}`}
                >
                  {item.name}
                </button>
                <p className="text-[10.5px] text-neutral-500">
                  فروشنده: {SELLER_TYPE_LABELS_FA[item.sellerType]}
                </p>
                <p className="text-[11.5px]">
                  از <Money value={item.priceFrom} currency={item.currency} />
                </p>
                <p className="text-[10.5px] text-neutral-500">
                  موجودیِ قابلِ فروش: {toPersianDigits(item.availability)}
                </p>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className={`border border-[#011c3a] px-4 py-2 text-[10.5px] text-[#011c3a] disabled:opacity-50 ${RING}`}
            >
              {loadingMore ? "در حالِ خواندن…" : "نمایشِ بیشتر"}
            </button>
          ) : (
            <p className="text-[10.5px] text-neutral-500">پایانِ نتایج</p>
          )}
        </>
      ) : null}
    </section>
  );
}

/* ── جزئیاتِ محصولِ عمده (تصمیمِ خریدار) ─────────────────────────────────── */

export function WholesaleProductDetailPage({
  client,
  productId,
  onBack,
}: {
  client: ApiClient;
  productId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<WholesaleProductDetail | null>(null);
  const [state, setState] = useState<CatalogViewState>({ kind: "LOADING" });
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setState({ kind: "LOADING" });
    setDetail(null);
    void (async () => {
      const result = await fetchWholesaleProductDetail(client, productId, { signal: controller.signal });
      if (id !== requestId.current) return;
      if (!result.ok) {
        setState({ kind: "ERROR", errorKind: result.error.kind, message: result.error.message });
        return;
      }
      setDetail(result.data);
      setSelectedVariantId(result.data.variants[0]?.id ?? null);
      setState(viewStateFromResult(result, true));
    })();
    return () => controller.abort();
  }, [client, productId, reloadKey]);

  const offer: WholesaleOffer | null = detail?.offers[0] ?? null;
  const variantNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const variant of detail?.variants ?? []) map.set(variant.id, variant.sku);
    return map;
  }, [detail]);

  return (
    <section aria-labelledby="wholesale-detail-heading" className="space-y-5">
      <button type="button" onClick={onBack} className={`text-[10.5px] text-[#0b2a46] underline underline-offset-4 ${RING}`}>
        بازگشت به کاتالوگ
      </button>

      {state.kind === "LOADING" ? <LoadingPanel label="در حالِ خواندنِ جزئیات…" /> : null}
      {state.kind === "ERROR" ? (
        <ErrorPanel kind={state.errorKind} message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : null}

      {detail ? (
        <>
          <header className="space-y-1">
            <h2 id="wholesale-detail-heading" className="text-[18px] font-semibold">{detail.name}</h2>
            <p className="text-[10.5px] text-neutral-500">
              فروشنده: {SELLER_TYPE_LABELS_FA[detail.sellerType]} · وضعیت: {detail.status || "—"}
            </p>
            {detail.description ? <p className="max-w-2xl text-[11.5px] leading-6 text-neutral-600">{detail.description}</p> : null}
          </header>

          {detail.media.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {detail.media.map((url: string, index: number) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${url}-${index}`} src={url} alt={`${detail.name} — تصویر ${toPersianDigits(index + 1)}`} className="h-24 w-24 border border-neutral-200 object-cover" />
              ))}
            </div>
          ) : null}

          {/* ── واریانت‌ها ─────────────────────────────────────────────────── */}
          <section aria-labelledby="wholesale-variants-heading" className="space-y-2">
            <h3 id="wholesale-variants-heading" className="text-[13px] font-semibold">واریانت‌ها</h3>
            {detail.variants.length === 0 ? (
              <EmptyPanel title="واریانتی ثبت نشده" body="سرور واریانتِ فعالی برای این محصول برنگرداند." />
            ) : (
              <div className="overflow-x-auto border border-neutral-200">
                <table className="w-full min-w-[520px] border-collapse text-[11px]">
                  <caption className="sr-only">فهرستِ واریانت‌های قابلِ انتخاب</caption>
                  <thead className="bg-[#efede7] text-right">
                    <tr>
                      <th scope="col" className="p-2 font-medium">انتخاب</th>
                      <th scope="col" className="p-2 font-medium">شناسه (SKU)</th>
                      <th scope="col" className="p-2 font-medium">ویژگی‌ها</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.variants.map((variant) => (
                      <tr key={variant.id} className="border-t border-neutral-200">
                        <td className="p-2">
                          <input
                            type="radio"
                            name="wholesale-variant"
                            checked={selectedVariantId === variant.id}
                            onChange={() => setSelectedVariantId(variant.id)}
                            aria-label={`انتخابِ واریانتِ ${variant.sku}`}
                            className={RING}
                          />
                        </td>
                        <td className="p-2"><LtrCode value={variant.sku} /></td>
                        <td className="p-2 text-neutral-600">
                          {Object.entries(variant.attributes ?? {}).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── پیشنهادِ تجاری ─────────────────────────────────────────────── */}
          <section aria-labelledby="wholesale-offer-heading" className="space-y-3">
            <h3 id="wholesale-offer-heading" className="text-[13px] font-semibold">شرایطِ عمده</h3>
            {!offer ? (
              <EmptyPanel title="پیشنهادِ عمده‌ای وجود ندارد" body="سرور پیشنهادِ منتشرشده‌ای برای این محصول برنگرداند." />
            ) : (
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-[10px] text-neutral-500">قیمتِ عمده</dt>
                  <dd className="text-[13px]"><Money value={offer.price} currency={offer.currency} /></dd>
                </div>
                {/* ⚠️ واحدِ MOQ بخشی ازِ خودِ عدد است: «۲ سری» ≠ «۲ عدد». */}
                <div>
                  <dt className="text-[10px] text-neutral-500">حداقلِ سفارش</dt>
                  <dd className="text-[13px] font-medium">{quantityWithUnit(offer.moq, offer.moqUnit)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-neutral-500">واحدِ قیمت‌گذاری</dt>
                  <dd className="text-[13px]">{pricingUnitLabel(offer.pricingUnit || offer.moqUnit)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-neutral-500">نوعِ بسته</dt>
                  <dd className="text-[13px]">
                    {offer.packageType
                      ? packageTypeLabel(offer.packageType)
                      : offer.packages[0]?.packageType
                        ? packageTypeLabel(offer.packages[0].packageType)
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-neutral-500">موجودیِ قابلِ فروش</dt>
                  <dd className="text-[13px]">{toPersianDigits(detail.availability)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-neutral-500">شناسهٔ پیشنهاد</dt>
                  <dd><LtrCode value={offer.sku || offer.id} /></dd>
                </div>
              </dl>
            )}
          </section>

          {/* ── ترکیبِ بسته / سری ──────────────────────────────────────────── */}
          {offer && offer.packages.length > 0 ? (
            <section aria-labelledby="wholesale-package-heading" className="space-y-2">
              <h3 id="wholesale-package-heading" className="text-[13px] font-semibold">داخلِ بسته چه چیزی است؟</h3>
              {offer.packages.map((pack) => (
                <div key={pack.id} className="border border-neutral-200 p-3">
                  <p className="text-[12px] font-medium">{pack.name}</p>
                  <p className="mt-0.5 text-[10.5px] text-neutral-500">
                    {packageTypeLabel(pack.packageType)} · مجموع: {toPersianDigits(pack.totalPieces)} قطعه
                  </p>
                  {pack.items.length > 0 ? (
                    <table className="mt-2 w-full border-collapse text-[11px]">
                      <caption className="sr-only">ترکیبِ واریانت‌های بسته</caption>
                      <thead className="bg-[#efede7] text-right">
                        <tr>
                          <th scope="col" className="p-2 font-medium">واریانت</th>
                          <th scope="col" className="p-2 font-medium">تعداد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pack.items.map((item) => (
                          <tr key={item.variantId} className="border-t border-neutral-200">
                            <td className="p-2"><LtrCode value={variantNameById.get(item.variantId) ?? item.variantId} /></td>
                            <td className="p-2 tabular-nums">{toPersianDigits(item.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {/* ── پله‌های قیمت ───────────────────────────────────────────────── */}
          {offer && offer.pricingTiers.length > 0 ? (
            <section aria-labelledby="wholesale-tiers-heading" className="space-y-2">
              <h3 id="wholesale-tiers-heading" className="text-[13px] font-semibold">قیمت بر پایهٔ تعداد</h3>
              <div className="overflow-x-auto border border-neutral-200">
                <table className="w-full min-w-[460px] border-collapse text-[11px]">
                  <caption className="sr-only">پله‌های قیمتِ عمده</caption>
                  <thead className="bg-[#efede7] text-right">
                    <tr>
                      <th scope="col" className="p-2 font-medium">از</th>
                      <th scope="col" className="p-2 font-medium">تا</th>
                      <th scope="col" className="p-2 font-medium">قیمتِ واحد</th>
                      <th scope="col" className="p-2 font-medium">واحد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offer.pricingTiers.map((tier, index) => (
                      <tr key={`${tier.minQuantity}-${index}`} className="border-t border-neutral-200">
                        <td className="p-2 tabular-nums">{toPersianDigits(tier.minQuantity)}</td>
                        {/* `null` یعنی پلهٔ باز — باید صادقانه «به بالا» خوانده شود. */}
                        <td className="p-2 tabular-nums">{tier.maxQuantity === null ? "به بالا" : toPersianDigits(tier.maxQuantity)}</td>
                        <td className="p-2"><Money value={tier.unitPrice} currency={tier.currency} /></td>
                        <td className="p-2">{moqUnitLabel(tier.moqUnit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {selectedVariantId ? (
            <p className="text-[10.5px] text-neutral-500">
              واریانتِ انتخاب‌شده: <LtrCode value={variantNameById.get(selectedVariantId) ?? selectedVariantId} />
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
