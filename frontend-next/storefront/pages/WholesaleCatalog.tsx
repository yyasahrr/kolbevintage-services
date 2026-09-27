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
import { fetchWholesaleCatalog, type WholesaleCatalogItem } from "../../shared/wholesale/catalog";
import {
  errorCopy,
  formatMoney,
  moqUnitLabel,
  packageTypeLabel,
  pricingUnitLabel,
  quantityWithUnit,
  SELLER_TYPE_LABELS_FA,
  toPersianDigits,
  viewStateFromResult,
  type CatalogViewState,
} from "../../shared/wholesale/presentation";

/* ── ارائهٔ فارسیِ enumهای دامنه (بدونِ ازبین‌بردنِ معنا) ─────────────────── */

/**
 * واژگانِ نمایش و قالب‌بندی به `shared/wholesale/presentation` منتقل شده است تا
 * فهرستِ کاتالوگ و «پیکربندِ سری» (فاز ۶.۴) **یک** زبان داشته باشند. این
 * re-exportها قراردادِ عمومیِ این فایل را نگه می‌دارند تا هیچ مصرف‌کننده یا
 * آزمونِ موجودی نشکند.
 */
export {
  MOQ_UNIT_LABELS_FA,
  PACKAGE_TYPE_LABELS_FA,
  PRICING_UNIT_LABELS_FA,
  SELLER_TYPE_LABELS_FA,
  moqUnitLabel,
  packageTypeLabel,
  pricingUnitLabel,
  quantityWithUnit,
  toPersianDigits,
  formatMoney,
  errorCopy,
  viewStateFromResult,
  type CatalogViewState,
} from "../../shared/wholesale/presentation";

/* ── قطعاتِ مشترکِ ظاهری ─────────────────────────────────────────────────── */

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--kolbe-color-focus)] focus-visible:ring-offset-2";

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
    <section aria-labelledby="wholesale-catalog-heading" className="kolbe-wholesale-catalog space-y-4">
      <header className="kolbe-wholesale-catalog__intro">
        <div>
          <p className="kolbe-wholesale-catalog__eyebrow">KOLBE WHOLESALE</p>
          <h1 id="wholesale-catalog-heading">فروشگاه عمده</h1>
        </div>
        <p>قیمت، موجودی و شرایط فروش مستقیماً از سرور خوانده می‌شود.</p>
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
          <ul className="kolbe-wholesale-grid">
            {items.map((item) => (
              <li key={item.id} className="kolbe-wholesale-card">
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className={`kolbe-wholesale-card__link ${RING}`}
                >
                  <span className="kolbe-wholesale-card__media">
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : <span aria-hidden="true">K</span>}
                    {item.sellerType === "KOLBE" ? <span className="kolbe-wholesale-card__badge">کلبه</span> : null}
                  </span>
                  <span className="kolbe-wholesale-card__body">
                    <strong>{item.name}</strong>
                    <span className="kolbe-wholesale-card__price">از <Money value={item.priceFrom} currency={item.currency} />{item.moqUnit ? <small> / {pricingUnitLabel(item.moqUnit)}</small> : null}</span>
                    {item.colors.length > 0 ? (
                      /* رنگ‌ها فقط نمایشِ حقیقتِ سرورند؛ اگر واریانتی رنگ نداشته باشد چیزی ساخته نمی‌شود. */
                      <span className="kolbe-wholesale-card__swatches">
                        {item.colors.slice(0, 4).map((color) => (
                          <span
                            key={`${color.label}-${color.hex ?? ""}`}
                            className="kolbe-wholesale-card__swatch"
                            style={color.hex ? { background: color.hex } : undefined}
                            title={color.label}
                          >
                            <span className="kolbe-visually-hidden">{color.label}</span>
                          </span>
                        ))}
                        {item.colors.length > 4 ? (
                          <span className="kolbe-wholesale-card__swatch-more">
                            +{toPersianDigits(item.colors.length - 4)}
                          </span>
                        ) : null}
                        <span className="kolbe-wholesale-card__swatch-count">
                          {item.colors.length === 1 ? "۱ رنگ" : `${toPersianDigits(item.colors.length)} رنگ`}
                        </span>
                      </span>
                    ) : null}
                    <span className="kolbe-wholesale-card__facts">
                      {item.seriesCount > 0 ? (
                        <span><small>شیوهٔ فروش</small>{item.seriesCount === 1 ? "۱ نوع سری" : `${toPersianDigits(item.seriesCount)} نوع سری`}</span>
                      ) : null}
                      {item.moq !== null && item.moqUnit ? <span><small>حداقل سفارش</small>{quantityWithUnit(item.moq, item.moqUnit)}</span> : null}
                      {item.packageLabel ? <span><small>نوع بسته</small>{packageTypeLabel(item.packageLabel)}</span> : null}
                      <span><small>موجودی قابل فروش</small>{toPersianDigits(item.availability)}</span>
                    </span>
                    <span className="kolbe-wholesale-card__seller">فروشنده: {item.sellerType === "SUPPLIER" && item.sellerName ? item.sellerName : SELLER_TYPE_LABELS_FA[item.sellerType]}</span>
                  </span>
                </button>
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

/**
 * صفحهٔ جزئیات در فاز ۶.۴ بازطراحی شده است: به‌جای جدولِ خامِ واریانت‌ها،
 * خریدار «رنگ → سری → تعدادِ سری» را انتخاب می‌کند (مدلِ فروشگاه، نه مدلِ
 * پایگاه‌داده). پیاده‌سازی در `storefront/vip/WholesaleProductDetail.tsx` است؛
 * این re-export نام و قراردادِ عمومی را برای `VIPPortal` و آزمون‌ها حفظ
 * می‌کند.
 */
export { WholesaleProductDetailPage } from "../vip/WholesaleProductDetail";
