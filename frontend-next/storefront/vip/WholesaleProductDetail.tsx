/**
 * جزئیاتِ محصولِ عمده — «پیکربندِ سری» (فاز ۶.۴ · بازطراحی).
 *
 * ── مدلِ UX ────────────────────────────────────────────────────────────────
 * خریدار عمده شبیهِ یک فروشگاهِ واقعی انتخاب می‌کند:
 *
 *   رنگ  →  سری/بستهٔ تعریف‌شدهٔ تأمین‌کننده  →  تعدادِ سری
 *
 * نه «واریانت → سایز → تعداد». واریانت‌ها همچنان مرجعِ موجودی و قیمت در
 * بک‌اند هستند، اما انتخاب‌گرِ اصلیِ مشتری نیستند: SKU و شناسه‌ها فقط در
 * «جزئیات فنی» (یک disclosure) نمایش داده می‌شوند.
 *
 * تعدادِ سری برای هر رنگ **مستقل** نیست و این صفحه یک order-builderِ چندرنگه
 * نیست: یک رنگ، یک سری، یک تعداد — درست مثلِ صفحهٔ محصولِ خرده‌فروشی. خریدِ
 * رنگِ دیگر یک درخواستِ جدا است و مدلِ «چند درخواست → یک سفارشِ والد» در
 * جریانِ سفارش (بعد از تأیید) همچنان معتبر می‌ماند.
 *
 * ── مرزِ حقیقت ─────────────────────────────────────────────────────────────
 * هر عددِ تجاری‌ای که اینجا دیده می‌شود از سرور آمده است:
 *   • نام/نوع/ترکیب/تعدادِ قطعاتِ بسته  ← wholesale_package(+item)
 *   • رنگ و سایز                        ← ویژگی‌های واریانت
 *   • قیمت و پله‌های قیمت               ← رشتهٔ اعشاریِ سرور
 *   • MOQ و **واحدِ MOQ**               ← seller_offer (هرگز به «عدد» فروکاسته نمی‌شود)
 *   • موجودی                            ← product_variant_inventory (محاسبه سمت سرور)
 * تنها محاسبهٔ کلاینت `count × totalPieces` است که بازتابِ فرمولِ مستند برای
 * پاسخ به «چند لباس می‌گیرم؟» است؛ نه پول است و نه به سرور فرستاده می‌شود.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { ApiErrorKind } from "../../shared/http/errors";
import type { ApiClient } from "../../shared/http/types";
import {
  fetchWholesaleProductDetail,
  type WholesaleOffer,
  type WholesaleProductDetail,
} from "../../shared/wholesale/catalog";
import {
  errorCopy,
  formatMoney,
  moqUnitLabel,
  packageTypeLabel,
  pricingUnitLabel,
  quantityWithUnit,
  toPersianDigits,
  viewStateFromResult,
  type CatalogViewState,
} from "../../shared/wholesale/presentation";
import {
  groupSeriesByColor,
  isPackageLikeUnit,
  pieceColorGroups,
  piecesForSeries,
  primaryOfferFor,
  seriesStepperBounds,
  type PieceColorGroup,
  type SeriesColorGroup,
  type SeriesOption,
} from "../../shared/wholesale/series";

/* ── قطعاتِ کوچک ────────────────────────────────────────────────────────── */

function Money({ value, currency }: { value: string; currency: string }) {
  return (
    <span dir="ltr" className="kolbe-pdp__money">
      {formatMoney(value)} <span className="kolbe-pdp__money-unit">{currency}</span>
    </span>
  );
}

function LtrCode({ value }: { value: string }) {
  return (
    <span dir="ltr" className="kolbe-code">
      {value}
    </span>
  );
}

function ErrorPanel({ kind, message, onRetry }: { kind: ApiErrorKind; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="kolbe-panel kolbe-panel--error">
      <p className="kolbe-panel__title">{errorCopy(kind, message)}</p>
      {/* شناسهٔ نوعِ خطا برای رهگیری؛ نه پیامِ خامِ بک‌اند. */}
      <p dir="ltr" className="kolbe-panel__code">
        {kind}
      </p>
      <button type="button" onClick={onRetry} className="kolbe-button" data-variant="secondary">
        تلاشِ دوباره
      </button>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" className="kolbe-panel kolbe-panel--empty">
      <p className="kolbe-panel__title">{title}</p>
      <p className="kolbe-panel__body">{body}</p>
    </div>
  );
}

/* ── گالری ─────────────────────────────────────────────────────────────── */

function ProductGallery({ media, name }: { media: string[]; name: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [media]);
  if (media.length === 0) {
    // حالتِ خالیِ صادقانه: هیچ گرادیان یا تصویرِ ساختگی جایِ رسانهٔ واقعی را نمی‌گیرد.
    return (
      <div className="kolbe-gallery kolbe-gallery--empty">
        <p className="kolbe-gallery__empty-title">تصویری برای این محصول ثبت نشده است</p>
        <p className="kolbe-gallery__empty-body">تأمین‌کننده برای این کالا رسانه‌ای بارگذاری نکرده است.</p>
      </div>
    );
  }
  const current = media[Math.min(active, media.length - 1)] ?? media[0]!;
  return (
    <div className="kolbe-gallery">
      <figure className="kolbe-gallery__stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt={`${name} — تصویر ${toPersianDigits(media.indexOf(current) + 1)}`} className="kolbe-gallery__image" />
      </figure>
      {media.length > 1 ? (
        <ul className="kolbe-gallery__thumbs" aria-label="تصویرهای محصول">
          {media.map((url, index) => (
            <li key={`${url}-${index}`}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-current={index === media.indexOf(current)}
                aria-label={`نمایشِ تصویر ${toPersianDigits(index + 1)}`}
                className="kolbe-gallery__thumb"
                data-active={index === media.indexOf(current)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="kolbe-gallery__thumb-image" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── انتخاب‌گرِ رنگ ─────────────────────────────────────────────────────── */

function ColorSwatches<T extends { key: string; label: string; colorHex: string | null }>({
  legend,
  groups,
  selectedKey,
  onSelect,
  counts,
}: {
  legend: string;
  groups: T[];
  selectedKey: string;
  onSelect: (key: string) => void;
  counts?: (group: T) => string | null;
}) {
  return (
    <fieldset className="kolbe-pdp__field">
      <legend className="kolbe-pdp__legend">
        {legend}
        <span className="kolbe-pdp__legend-value">{groups.find((group) => group.key === selectedKey)?.label}</span>
      </legend>
      <div className="kolbe-swatches">
        {groups.map((group) => (
          <label key={group.key} className="kolbe-swatch" data-selected={group.key === selectedKey}>
            <input
              type="radio"
              name="wholesale-pdp-color"
              className="kolbe-visually-hidden"
              value={group.key}
              checked={group.key === selectedKey}
              onChange={() => onSelect(group.key)}
            />
            <span className="kolbe-swatch__dot" style={group.colorHex ? { background: group.colorHex } : undefined} aria-hidden="true" />
            <span className="kolbe-swatch__text">
              <span className="kolbe-swatch__label">{group.label}</span>
              {counts?.(group) ? <span className="kolbe-swatch__meta">{counts(group)}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ── کارتِ سری ─────────────────────────────────────────────────────────── */

function SeriesCard({
  option,
  selected,
  onSelect,
  unitLabel,
}: {
  option: SeriesOption;
  selected: boolean;
  onSelect: () => void;
  unitLabel: string;
}) {
  const preview = option.composition.map((row) => `${row.size}×${toPersianDigits(row.quantity)}`).join("  ·  ");
  return (
    <label className="kolbe-series-option" data-selected={selected}>
      <input
        type="radio"
        name="wholesale-pdp-series"
        className="kolbe-visually-hidden"
        value={option.id}
        checked={selected}
        onChange={onSelect}
      />
      <span className="kolbe-series-option__head">
        <span className="kolbe-series-option__name">{option.name}</span>
        <span className="kolbe-series-option__pieces">مجموع: {toPersianDigits(option.totalPieces)} قطعه</span>
      </span>
      <span className="kolbe-series-option__type">{packageTypeLabel(option.packageType)}</span>
      {preview ? <span className="kolbe-series-option__preview">{preview}</span> : null}
      <span className="kolbe-series-option__stock">
        {option.availablePackages === null
          ? "موجودی اعلام نشده"
          : `${toPersianDigits(option.availablePackages)} ${unitLabel} آماده`}
      </span>
    </label>
  );
}

/* ── استپر ─────────────────────────────────────────────────────────────── */

function SeriesStepper({
  value,
  min,
  max,
  unitLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number | null;
  unitLabel: string;
  onChange: (next: number) => void;
}) {
  const clamp = (next: number): number => {
    if (!Number.isSafeInteger(next)) return min;
    const bounded = Math.max(min, next);
    return max === null ? bounded : Math.min(max, bounded);
  };
  return (
    <div className="kolbe-stepper">
      <button
        type="button"
        className="kolbe-stepper__button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label={`کاهشِ تعدادِ ${unitLabel}`}
      >
        <span aria-hidden="true">−</span>
      </button>
      <label className="kolbe-stepper__field">
        <span className="kolbe-visually-hidden">تعدادِ {unitLabel}</span>
        <input
          className="kolbe-stepper__input"
          type="number"
          inputMode="numeric"
          min={min}
          step={1}
          {...(max === null ? {} : { max })}
          value={Number.isFinite(value) ? value : min}
          onChange={(event) => {
            const parsed = Number.parseInt(event.currentTarget.value, 10);
            onChange(Number.isNaN(parsed) ? min : clamp(parsed));
          }}
        />
      </label>
      <button
        type="button"
        className="kolbe-stepper__button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={max !== null && value >= max}
        aria-label={`افزایشِ تعدادِ ${unitLabel}`}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/* ── صفحه ─────────────────────────────────────────────────────────────── */

export function WholesaleProductDetailPage({
  client,
  productId,
  onBack,
  canRequest = false,
  onRequestCreated,
}: {
  client: ApiClient;
  productId: string;
  onBack: () => void;
  canRequest?: boolean;
  onRequestCreated?: () => void;
}) {
  const [detail, setDetail] = useState<WholesaleProductDetail | null>(null);
  const [state, setState] = useState<CatalogViewState>({ kind: "LOADING" });
  const [colorKey, setColorKey] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [seriesCount, setSeriesCount] = useState(1);
  const [pieceVariantId, setPieceVariantId] = useState<string | null>(null);
  const [pieceCount, setPieceCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
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
      setState(viewStateFromResult(result, true));
    })();
    return () => controller.abort();
  }, [client, productId, reloadKey]);

  const offer: WholesaleOffer | null = detail ? primaryOfferFor(detail) : null;
  const packageSale = !!offer && isPackageLikeUnit(offer.moqUnit);
  const unitLabel = offer ? moqUnitLabel(offer.moqUnit) : "عدد";

  const colorGroups: SeriesColorGroup[] = useMemo(
    () => (detail && offer ? groupSeriesByColor(detail, offer) : []),
    [detail, offer],
  );
  const pieceGroups: PieceColorGroup[] = useMemo(() => (detail ? pieceColorGroups(detail) : []), [detail]);

  /* انتخابِ پیش‌فرض: نخستین رنگ و نخستین سریِ همان رنگ — هیچ چیزی از پیش «بهترین» فرض نمی‌شود. */
  useEffect(() => {
    if (!detail || !offer) return;
    if (packageSale) {
      if (offer.packages.length === 0) return;
      const groups = groupSeriesByColor(detail, offer);
      const firstGroup = groups[0];
      if (!firstGroup) return;
      setColorKey((current) => (current && groups.some((group) => group.key === current) ? current : firstGroup.key));
      setPackageId((current) => {
        const inScope = groups.flatMap((group) => group.options);
        return current && inScope.some((option) => option.id === current) ? current : (firstGroup.options[0]?.id ?? null);
      });
      setSeriesCount((current) => (current > 0 ? current : offer.moq));
    } else {
      const groups = pieceColorGroups(detail);
      const firstSize = groups[0]?.sizes[0];
      setPieceVariantId((current) => (current && detail.variants.some((v) => v.id === current) ? current : (firstSize?.variantId ?? null)));
      setPieceCount((current) => (current > 0 ? current : offer.moq));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, offer, packageSale]);

  const activeGroup: SeriesColorGroup | null =
    colorGroups.find((group) => group.key === colorKey) ?? colorGroups[0] ?? null;
  const options: SeriesOption[] = activeGroup?.options ?? [];
  const selectedOption: SeriesOption | null = options.find((option) => option.id === packageId) ?? options[0] ?? null;
  const bounds = selectedOption ? seriesStepperBounds(selectedOption, offer?.moq ?? 1) : { min: 1, max: null };
  const effectiveCount = Math.max(bounds.min, seriesCount);
  const totalPieces = selectedOption ? piecesForSeries(selectedOption, effectiveCount) : 0;

  const activePieceGroup = pieceGroups.find((group) => group.sizes.some((size) => size.variantId === pieceVariantId)) ?? pieceGroups[0] ?? null;
  const activePieceVariant = activePieceGroup?.sizes.find((size) => size.variantId === pieceVariantId) ?? activePieceGroup?.sizes[0] ?? null;

  const canSubmit = packageSale
    ? !!selectedOption && !!offer && canRequest && !busy && effectiveCount >= (offer.moq || 1)
    : !!activePieceVariant && !!offer && canRequest && !busy && pieceCount >= (offer.moq || 1);

  const submit = async () => {
    if (!offer || !canSubmit) return;
    const selector = packageSale ? { packageId: selectedOption!.id } : { variantId: activePieceVariant!.variantId };
    const quantity = packageSale ? effectiveCount : pieceCount;
    setBusy(true);
    setMessage(null);
    const result = await client.requestResult<{ id: string }>("/vip/requests", {
      method: "POST",
      body: { productId, offerId: offer.id, quantity, ...selector },
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error.message });
      return;
    }
    setMessage({ kind: "success", text: `درخواست ثبت شد و برای تأییدِ تأمین‌کننده فرستاده شد.` });
    onRequestCreated?.();
  };

  const selectColor = (key: string) => {
    setColorKey(key);
    const group = colorGroups.find((entry) => entry.key === key);
    const first = group?.options[0];
    if (first) {
      setPackageId(first.id);
      if (offer) setSeriesCount(Math.max(offer.moq, seriesCount));
    }
  };

  return (
    <article className="kolbe-pdp" aria-labelledby="kolbe-pdp-title">
      <nav className="kolbe-pdp__breadcrumb" aria-label="مسیر">
        <button type="button" onClick={onBack} className="kolbe-back">
          <span aria-hidden="true">→</span> بازگشت به کاتالوگ عمده
        </button>
      </nav>

      {state.kind === "LOADING" ? (
        <div className="kolbe-pdp__skeleton" role="status" aria-live="polite">
          <span className="kolbe-visually-hidden">در حالِ خواندنِ جزئیاتِ محصول…</span>
          <div className="kolbe-pdp__skeleton-media" />
          <div className="kolbe-pdp__skeleton-lines">
            <div className="kolbe-pdp__skeleton-line kolbe-pdp__skeleton-line--title" />
            <div className="kolbe-pdp__skeleton-line" />
            <div className="kolbe-pdp__skeleton-line kolbe-pdp__skeleton-line--short" />
          </div>
        </div>
      ) : null}

      {state.kind === "ERROR" ? (
        <ErrorPanel kind={state.errorKind} message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : null}

      {detail ? (
        <>
          <div className="kolbe-pdp__hero">
            <ProductGallery media={detail.media} name={detail.name} />

            <div className="kolbe-pdp__intro">
              <p className="kolbe-pdp__eyebrow">
                {detail.sellerType === "KOLBE" ? "کلبه وینتیج" : detail.sellerType === "SUPPLIER" ? "تأمین‌کننده" : "فروشنده"}
                {detail.status ? ` · ${detail.status}` : ""}
              </p>
              <h1 id="kolbe-pdp-title" className="kolbe-pdp__title">
                {detail.name}
              </h1>
              {detail.description ? <p className="kolbe-pdp__description">{detail.description}</p> : null}

              {offer ? (
                <dl className="kolbe-facts">
                  <div className="kolbe-facts__price">
                    <dt>قیمتِ عمده</dt>
                    <dd>
                      <Money value={offer.price} currency={offer.currency} />
                      <span className="kolbe-facts__unit">برای هر {pricingUnitLabel(offer.pricingUnit || offer.moqUnit)}</span>
                    </dd>
                  </div>
                  {/* ⚠️ واحدِ MOQ بخشی ازِ خودِ عدد است: «۲ سری» ≠ «۲ عدد». */}
                  <div>
                    <dt>حداقلِ سفارش</dt>
                    <dd>
                      <span className="kolbe-facts__strong">{quantityWithUnit(offer.moq, offer.moqUnit)}</span>
                      {packageSale && selectedOption ? (
                        <span className="kolbe-facts__unit">
                          هر {moqUnitLabel(offer.moqUnit)} {toPersianDigits(selectedOption.totalPieces)} عدد
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt>موجودیِ قابلِ فروش</dt>
                    <dd>
                      <span>{toPersianDigits(detail.availability)}</span>
                    </dd>
                  </div>
                </dl>
              ) : (
                <EmptyPanel
                  title="پیشنهادِ عمده‌ای وجود ندارد"
                  body="سرور پیشنهادِ منتشرشده‌ای برای این محصول برنگرداند؛ بدونِ پیشنهاد، قیمت و شرایط فروشی وجود ندارد."
                />
              )}
            </div>
          </div>

          {offer ? (
            <div className="kolbe-configurator">
              {packageSale ? (
                <>
                  {colorGroups.length === 0 || options.length === 0 ? (
                    <EmptyPanel
                      title="سری‌ای تعریف نشده است"
                      body="تأمین‌کننده برای این پیشنهاد هیچ بسته یا سریِ منتشرشده‌ای تعریف نکرده است."
                    />
                  ) : (
                    <>
                      <ColorSwatches
                        legend="رنگ"
                        groups={colorGroups}
                        selectedKey={activeGroup?.key ?? ""}
                        onSelect={selectColor}
                        counts={(group) =>
                          group.options.length === 1 ? "۱ نوع سری" : `${toPersianDigits(group.options.length)} نوع سری`
                        }
                      />

                      <fieldset className="kolbe-pdp__field">
                        <legend className="kolbe-pdp__legend">نوعِ سری</legend>
                        <div className="kolbe-series-options">
                          {options.map((option) => (
                            <SeriesCard
                              key={option.id}
                              option={option}
                              selected={option.id === selectedOption?.id}
                              onSelect={() => setPackageId(option.id)}
                              unitLabel={unitLabel}
                            />
                          ))}
                        </div>
                      </fieldset>

                      {selectedOption ? (
                        <section className="kolbe-composition" aria-labelledby="kolbe-composition-title">
                          <h2 id="kolbe-composition-title" className="kolbe-section__title">
                            ترکیبِ سری
                          </h2>
                          <p className="kolbe-section__body">
                            هر {moqUnitLabel(offer.moqUnit)} شامل {toPersianDigits(selectedOption.totalPieces)} عدد با این
                            ترکیب است. ترکیب را تأمین‌کننده تعریف کرده و قابلِ تغییر نیست.
                          </p>
                          <ul className="kolbe-composition__list">
                            {selectedOption.composition.map((row) => (
                              <li key={row.variantId} className="kolbe-composition__item">
                                <span className="kolbe-composition__size">{row.size || "—"}</span>
                                <span className="kolbe-composition__count">×{toPersianDigits(row.quantity)}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      <section className="kolbe-quantity" aria-labelledby="kolbe-quantity-title">
                        <h2 id="kolbe-quantity-title" className="kolbe-section__title">
                          تعدادِ سفارش
                        </h2>
                        <SeriesStepper
                          value={effectiveCount}
                          min={bounds.min}
                          max={bounds.max}
                          unitLabel={unitLabel}
                          onChange={setSeriesCount}
                        />
                        <p className="kolbe-quantity__result" aria-live="polite">
                          <span>
                            {toPersianDigits(effectiveCount)} {unitLabel} · {toPersianDigits(totalPieces)} عدد
                          </span>
                        </p>
                      </section>
                    </>
                  )}
                </>
              ) : (
                <>
                  {pieceGroups.length === 0 ? (
                    <EmptyPanel title="واریانتی ثبت نشده" body="سرور واریانتِ فعالی برای این محصول برنگرداند." />
                  ) : (
                    <>
                      <ColorSwatches
                        legend="رنگ"
                        groups={pieceGroups.map((group) => ({ key: group.key, label: group.label, colorHex: group.colorHex }))}
                        selectedKey={activePieceGroup?.key ?? ""}
                        onSelect={(key) => {
                          const group = pieceGroups.find((entry) => entry.key === key);
                          const first = group?.sizes[0];
                          if (first) setPieceVariantId(first.variantId);
                        }}
                      />
                      <fieldset className="kolbe-pdp__field">
                        <legend className="kolbe-pdp__legend">سایز</legend>
                        <div className="kolbe-sizes">
                          {(activePieceGroup?.sizes ?? []).map((size) => (
                            <label key={size.variantId} className="kolbe-size" data-selected={size.variantId === pieceVariantId}>
                              <input
                                type="radio"
                                name="wholesale-pdp-size"
                                className="kolbe-visually-hidden"
                                checked={size.variantId === pieceVariantId}
                                onChange={() => setPieceVariantId(size.variantId)}
                              />
                              <span>{size.size || "—"}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <section className="kolbe-quantity" aria-labelledby="kolbe-quantity-title">
                        <h2 id="kolbe-quantity-title" className="kolbe-section__title">
                          تعدادِ سفارش
                        </h2>
                        <SeriesStepper
                          value={pieceCount}
                          min={offer.moq}
                          max={null}
                          unitLabel={unitLabel}
                          onChange={setPieceCount}
                        />
                        <p className="kolbe-quantity__result" aria-live="polite">
                          <span>
                            {toPersianDigits(pieceCount)} {unitLabel}
                          </span>
                        </p>
                      </section>
                    </>
                  )}
                </>
              )}

              {offer.pricingTiers.length > 0 ? (
                <section className="kolbe-tiers" aria-labelledby="kolbe-tiers-title">
                  <h2 id="kolbe-tiers-title" className="kolbe-section__title">
                    قیمت بر پایهٔ تعدادِ {unitLabel}
                  </h2>
                  <ul className="kolbe-tiers__list">
                    {offer.pricingTiers.map((tier, index) => (
                      <li key={`${tier.minQuantity}-${index}`} className="kolbe-tiers__item">
                        <span className="kolbe-tiers__range">
                          {toPersianDigits(tier.minQuantity)}
                          {tier.maxQuantity === null ? (
                            <span> به بالا</span>
                          ) : (
                            <span> تا {toPersianDigits(tier.maxQuantity)}</span>
                          )}
                        </span>
                        <Money value={tier.unitPrice} currency={tier.currency} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <details className="kolbe-tech">
                <summary className="kolbe-tech__summary">جزئیاتِ فنی</summary>
                <div className="kolbe-tech__body">
                  <section>
                    <h3 className="kolbe-tech__title">واریانت‌های محصول</h3>
                    <ul className="kolbe-tech__list">
                      {detail.variants.map((variant) => (
                        <li key={variant.id} className="kolbe-tech__row">
                          <LtrCode value={variant.sku} />
                          <span className="kolbe-tech__meta">
                            {[variant.color, variant.size].filter((value) => value.trim().length > 0).join(" · ") || "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  {selectedOption && selectedOption.composition.length > 0 ? (
                    <section>
                      <h3 className="kolbe-tech__title">دستورِ پختِ «{selectedOption.name}»</h3>
                      <ul className="kolbe-tech__list">
                        {selectedOption.composition.map((row) => (
                          <li key={row.variantId} className="kolbe-tech__row">
                            <LtrCode value={row.sku} />
                            <span className="kolbe-tech__meta">
                              {row.size || "—"} · {toPersianDigits(row.quantity)} عدد
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}

          {offer ? (
            <div className="kolbe-purchase" role="region" aria-label="خلاصهٔ درخواست">
              <div className="kolbe-purchase__summary">
                <p className="kolbe-purchase__line">
                  {packageSale ? (
                    <span>
                      {activeGroup?.label} · {selectedOption?.name}
                    </span>
                  ) : (
                    <span>
                      {activePieceGroup?.label} · سایز {activePieceVariant?.size}
                    </span>
                  )}
                </p>
                <p className="kolbe-purchase__totals">
                  <span>
                    {toPersianDigits(packageSale ? effectiveCount : pieceCount)} {unitLabel}
                    {packageSale ? ` · ${toPersianDigits(totalPieces)} عدد` : ""}
                  </span>
                </p>
              </div>
              <div className="kolbe-purchase__actions">
                <button type="button" className="kolbe-button" onClick={() => void submit()} disabled={!canSubmit}>
                  {busy ? "در حالِ ثبت…" : "ثبت درخواست عمده"}
                </button>
              </div>
            </div>
          ) : null}

          <div aria-live="polite" className="kolbe-request-message">
            {message ? (
              <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "kolbe-message kolbe-message--error" : "kolbe-message kolbe-message--success"}>
                {message.text}
              </p>
            ) : null}
            {!message && !canRequest ? (
              <p role="status" className="kolbe-message kolbe-message--muted">
                مجوزِ ثبتِ درخواست برای این نشست از سوی سرور صادر نشده است. مشاهدهٔ کاتالوگ و ثبتِ درخواست دو دسترسیِ
                جدا هستند.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </article>
  );
}
