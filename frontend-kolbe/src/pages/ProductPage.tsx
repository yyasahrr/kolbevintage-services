import { useSiteSettings } from "../siteSettings";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouter } from "../router";
import { productById, products, specLabels, specOrder, type Product } from "../data/catalog";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import Icon from "../components/Icon";
import Lightbox from "../components/Lightbox";
import SizeAdvisor from "../components/SizeAdvisor";
import ProductCard from "../components/ProductCard";
import type { AdminProductRecord } from "../adminProducts";

/*
 * چیدمان صفحه جزیات محصول — بر اساس الگوی استاندارد PDP (آمازون / دیجی‌کالا / زالاندو)
 *
 *  ┌────────────────────────────────────────────────────────────┐
 *  │ بردکرامب (جهت‌یابی)                                          │
 *  ├──────────────────────────────┬─────────────────────────────┤
 *  │  گالری (ستارهٔ توجه) — چسبان │  باکس خرید — هرم اطلاعات    │
 *  │  تصویر ۴:۵ بزرگ + ریل عمودی  │  عنوان ← امتیاز ← قیمت ←    │
 *  │  تامنیل (الگوی دیجی‌کالا)     │  رنگ ← سایز ← CTA ← اعتماد  │
 *  ├──────────────────────────────┴─────────────────────────────┤
 *  │ زیرمنوی چسبان بخش‌ها (جزئیات / ست / نظرات / مشابه)           │
 *  ├────────────────────────────────────────────────────────────┤
 *  │ جزئیات محصول: توضیحات + آکاردئون │ جدول مشخصات فنی          │
 *  │ با این ست کنید (کراس‌سل) │ نظرات (اثبات اجتماعی) │ مشابه     │
 *  └────────────────────────────────────────────────────────────┘
 *  + نوار خرید چسبان پایین صفحه وقتی CTA از دید خارج شد
 */

/* --------------------------------- ستاره‌ها --------------------------------- */

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="product-stars inline-flex items-center gap-[1px]" aria-label={`امتیاز ${fa(value)} از ۵`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={i <= Math.round(value) ? "star-filled" : "star-empty"}
        >
          <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
        </svg>
      ))}
    </span>
  );
}

/* --------------------------------- گالری ----------------------------------- */

function ZoomImage({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  return (
    <figure
      className="product-gallery-media relative cursor-zoom-in overflow-hidden rounded-2xl"
      onMouseEnter={() => setZoom(true)}
      onMouseLeave={() => setZoom(false)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
      onClick={onOpen}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="aspect-[4/5] max-h-[78vh] w-full object-contain transition-transform duration-300"
        style={{ transform: zoom ? "scale(1.7)" : "scale(1)", transformOrigin: `${pos.x}% ${pos.y}%` }}
      />
    </figure>
  );
}

type DesktopMedia = { kind: "video"; poster: string } | { kind: "image"; src: string };

function Gallery({
  product,
  onOpen,
  activeImage,
  setActiveImage,
}: {
  product: Product;
  onOpen: (i: number) => void;
  activeImage: number;
  setActiveImage: (i: number) => void;
}) {
  const media = product.images;
  const videoOffset = product.video ? 1 : 0;
  const desktopMedia: DesktopMedia[] = [
    ...(product.video ? [{ kind: "video" as const, poster: product.video.poster }] : []),
    ...media.map((src) => ({ kind: "image" as const, src })),
  ];
  const videoActive = Boolean(product.video) && activeImage === 0;

  /* ---- موبایل: اسلایدر لمسی ---- */
  const mobileMediaCount = media.length + (product.video ? 1 : 0);
  const mobileRailRef = useRef<HTMLDivElement>(null);
  const [activeMobileMedia, setActiveMobileMedia] = useState(0);

  const goToMobileMedia = (index: number) => {
    const next = Math.max(0, Math.min(mobileMediaCount - 1, index));
    const rail = mobileRailRef.current;
    const slide = rail?.children.item(next) as HTMLElement | null;
    slide?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    setActiveMobileMedia(next);
  };

  const updateActiveMobileMedia = () => {
    const rail = mobileRailRef.current;
    if (!rail) return;
    const railBox = rail.getBoundingClientRect();
    const railCenter = railBox.left + railBox.width / 2;
    const closest = Array.from(rail.children).reduce(
      (best, child, index) => {
        const box = child.getBoundingClientRect();
        const distance = Math.abs(box.left + box.width / 2 - railCenter);
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    );
    setActiveMobileMedia(Math.min(closest.index, mobileMediaCount - 1));
  };

  return (
    <>
      {/* ================================ موبایل ================================ */}
      <div className="product-gallery-mobile relative -mx-4 sm:-mx-6 lg:hidden">
        <div ref={mobileRailRef} onScroll={updateActiveMobileMedia} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto">
          {media.map((src, i) => (
            <button
              key={src + i}
              type="button"
              className="w-full shrink-0 snap-center"
              onClick={() => onOpen(i)}
              aria-label={`نمایش تصویر ${fa(i + 1)} از ${fa(media.length)}`}
            >
              <img
                src={src}
                alt={`${product.name} — تصویر ${fa(i + 1)}`}
                loading={i === 0 ? "eager" : "lazy"}
                className="product-gallery-media h-[54svh] max-h-[540px] min-h-[320px] w-full object-contain"
              />
            </button>
          ))}
          {product.video && (
            <button type="button" onClick={() => window.open(product.video!.url, "_blank")} className="relative w-full shrink-0 snap-center" aria-label={product.video.title}>
              <img src={product.video.poster} alt={product.video.title} loading="lazy" className="product-gallery-media h-[54svh] max-h-[540px] min-h-[320px] w-full object-contain brightness-75" />
              <span className="absolute inset-0 flex items-center justify-center text-white">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70 backdrop-blur-sm">
                  <Icon name="play" className="mr-1 h-5 w-5" fill="currentColor" strokeWidth={0} />
                </span>
              </span>
            </button>
          )}
        </div>

        {/* نشانگر + فلش‌ها */}
        {mobileMediaCount > 1 && (
          <>
            <span className="absolute bottom-3 right-1/2 translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[10px] text-white backdrop-blur-sm num-fa">
              {fa(activeMobileMedia + 1)} / {fa(mobileMediaCount)}
            </span>
            <button type="button" onClick={() => goToMobileMedia(activeMobileMedia - 1)} disabled={activeMobileMedia === 0} aria-label="تصویر قبلی" className="product-gallery-arrow absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-25">
              <Icon name="chevronRight" className="h-5 w-5" strokeWidth={1.6} />
            </button>
            <button type="button" onClick={() => goToMobileMedia(activeMobileMedia + 1)} disabled={activeMobileMedia === mobileMediaCount - 1} aria-label="تصویر بعدی" className="product-gallery-arrow absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-25">
              <Icon name="chevronLeft" className="h-5 w-5" strokeWidth={1.6} />
            </button>
          </>
        )}

        {/* تامنیل‌ها */}
        {mobileMediaCount > 1 && (
          <div className="product-gallery-thumbs no-scrollbar flex gap-2 overflow-x-auto px-4 py-3" aria-label="تصاویر کوچک محصول">
            {media.map((src, i) => (
              <button key={src + i} type="button" onClick={() => goToMobileMedia(i)} aria-label={`رفتن به تصویر ${fa(i + 1)}`} aria-current={activeMobileMedia === i ? "true" : undefined} className={`pdp-thumb h-16 w-12 shrink-0 ${activeMobileMedia === i ? "is-active" : ""}`}>
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
            {product.video && (
              <button type="button" onClick={() => goToMobileMedia(media.length)} aria-label="رفتن به ویدئوی محصول" aria-current={activeMobileMedia === media.length ? "true" : undefined} className={`pdp-thumb relative h-16 w-12 shrink-0 ${activeMobileMedia === media.length ? "is-active" : ""}`}>
                <img src={product.video.poster} alt="" className="h-full w-full object-cover brightness-75" />
                <Icon name="play" className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white" fill="currentColor" strokeWidth={0} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ========================== دسکتاپ / تبلت بزرگ ========================== */}
      <div className="hidden gap-3 lg:flex">
        {/* ریل عمودی تامنیل — لبهٔ راست (الگوی دیجی‌کالا) */}
        {desktopMedia.length > 1 && (
          <div className="no-scrollbar flex max-h-[78vh] w-[58px] shrink-0 flex-col gap-2 overflow-y-auto pl-0.5" aria-label="تصاویر کوچک محصول">
            {desktopMedia.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveImage(i)}
                aria-label={m.kind === "video" ? "نمایش ویدئوی محصول" : `نمایش تصویر ${fa(i + 1 - videoOffset)}`}
                aria-current={activeImage === i ? "true" : undefined}
                className={`pdp-thumb relative h-[74px] w-full shrink-0 ${activeImage === i ? "is-active" : ""}`}
              >
                <img src={m.kind === "video" ? m.poster : m.src} alt="" loading="lazy" className="h-full w-full object-cover" />
                {m.kind === "video" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                    <Icon name="play" className="mr-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* تصویر اصلی */}
        <div className="relative min-w-0 flex-1">
          {/* برچسب‌ها */}
          {product.badges.length > 0 && (
            <div className="absolute right-3 top-3 z-10 flex gap-1.5">
              {product.badges.map((b) => (
                <span key={b} className="pdp-badge rounded-full bg-[#c9654d] px-3 py-1 text-[10px] font-medium text-white">{b}</span>
              ))}
            </div>
          )}

          {videoActive ? (
            <button onClick={() => window.open(product.video!.url, "_blank")} className="group relative w-full overflow-hidden rounded-2xl bg-neutral-900">
              <img src={product.video!.poster} alt={product.video!.title} className="aspect-[4/5] max-h-[78vh] w-full object-cover opacity-75 transition group-hover:opacity-65" />
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70 backdrop-blur-sm">
                  <Icon name="play" className="mr-1 h-5 w-5" fill="currentColor" strokeWidth={0} />
                </span>
                <span className="text-[11.5px]">{product.video!.title}</span>
              </span>
            </button>
          ) : (
            <ZoomImage
              src={media[activeImage - videoOffset] ?? media[0]}
              alt={`${product.name} — تصویر ${fa(activeImage + 1 - videoOffset)}`}
              onOpen={() => onOpen(Math.max(0, activeImage - videoOffset))}
            />
          )}

          {/* فلش‌ها */}
          {desktopMedia.length > 1 && (
            <>
              <button type="button" onClick={() => setActiveImage(Math.max(0, activeImage - 1))} disabled={activeImage === 0} aria-label="تصویر قبلی" className="product-gallery-arrow absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-0">
                <Icon name="chevronRight" className="h-5 w-5" strokeWidth={1.6} />
              </button>
              <button type="button" onClick={() => setActiveImage(Math.min(desktopMedia.length - 1, activeImage + 1))} disabled={activeImage === desktopMedia.length - 1} aria-label="تصویر بعدی" className="product-gallery-arrow absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-0">
                <Icon name="chevronLeft" className="h-5 w-5" strokeWidth={1.6} />
              </button>
            </>
          )}

          {/* شمارنده */}
          {!videoActive && media.length > 1 && (
            <span className="absolute bottom-3 left-3 z-10 rounded-full bg-black/45 px-3 py-1 text-[10px] text-white backdrop-blur-sm num-fa">
              {fa(activeImage + 1 - videoOffset)} / {fa(media.length)}
            </span>
          )}

          {/* راهنمای بزرگ‌نمایی */}
          <span className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded-full bg-black/35 px-2.5 py-1 text-[9.5px] text-white/90 backdrop-blur-sm xl:block">
            برای بزرگ‌نمایی نشانگر را روی تصویر ببرید
          </span>
        </div>
      </div>
    </>
  );
}

/* ------------------------------ چرخ رنگ محصول ------------------------------- */

function ColourWheel({
  product,
  selected,
  onSelect,
}: {
  product: Product;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const n = product.colours.length;
  const sel = product.colours[selected];

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] font-medium">
          رنگ: <span className="text-[#011c3a]">{sel.name}</span>
        </p>
        <p className="text-[11px] text-neutral-500 num-fa">{fa(n)} رنگ</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label="انتخاب رنگ محصول">
        {product.colours.map((c, i) => (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={i === selected}
            aria-label={c.name}
            title={c.name}
            onClick={() => onSelect(i)}
            className={`pdp-swatch flex h-10 w-10 items-center justify-center rounded-full border transition ${i === selected ? "is-selected" : ""}`}
          >
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-black/10" style={{ backgroundColor: c.hex }}>
              {i === selected && <Icon name="check" className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" strokeWidth={3} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- پنل سفارش عمده (B2B) --------------------------- */

function WholesaleOrderPanel({
  product,
  colourIdx,
  onColourChange,
}: {
  product: Product;
  colourIdx: number;
  onColourChange: (i: number) => void;
}) {
  type WholesaleLine = {
    key: string;
    productId: string;
    productName: string;
    productCode: string;
    colour: string;
    colourHex: string;
    size: string;
    qty: number;
    collectionName?: string;
    services?: string[];
    customizationNote?: string;
  };

  const firstSize = product.sizes.find((s) => s.inStock)?.label ?? "";
  const [selectedSize, setSelectedSize] = useState(firstSize);
  const collectionPacks = [
    { id: "starter", name: "کالکشن شروع", qty: 12, mix: "S×۲ · M×۴ · L×۴ · XL×۲" },
    { id: "display", name: "کالکشن ویترین", qty: 24, mix: "S×۴ · M×۸ · L×۸ · XL×۴" },
    { id: "complete", name: "کالکشن کامل", qty: 48, mix: "S×۸ · M×۱۶ · L×۱۶ · XL×۸" },
  ];
  const [packId, setPackId] = useState("display");
  const [services, setServices] = useState<string[]>([]);
  const [customizationNote, setCustomizationNote] = useState("");
  const [lines, setLines] = useState<WholesaleLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("kv_wholesale_draft") ?? "[]") as WholesaleLine[];
    } catch {
      return [];
    }
  });
  const [submitted, setSubmitted] = useState(false);
  const colour = product.colours[colourIdx];
  const pack = collectionPacks.find((item) => item.id === packId)!;
  const qty = pack.qty;
  const total = lines.reduce((sum, line) => sum + line.qty, 0);
  const baseWholesalePrice = Math.round(product.price * 0.68 / 10_000) * 10_000;
  const unitPrice = qty >= 48 ? Math.round(baseWholesalePrice * 0.88 / 10_000) * 10_000 : qty >= 24 ? Math.round(baseWholesalePrice * 0.94 / 10_000) * 10_000 : baseWholesalePrice;

  useEffect(() => {
    setSelectedSize(product.sizes.find((s) => s.inStock)?.label ?? "");
    setPackId("display");
    setServices([]);
    setCustomizationNote("");
    setSubmitted(false);
  }, [product.id]);

  useEffect(() => {
    localStorage.setItem("kv_wholesale_draft", JSON.stringify(lines));
  }, [lines]);

  const addLine = () => {
    if (!selectedSize) return;
    const key = `${product.id}|${colour.name}|${pack.id}`;
    setSubmitted(false);
    setLines((current) => {
      const found = current.find((line) => line.key === key);
      if (found) return current.map((line) => line.key === key ? { ...line, qty, services, customizationNote } : line);
      return [...current, {
        key,
        productId: product.id,
        productName: product.name,
        productCode: product.specs.code,
        colour: colour.name,
        colourHex: colour.hex,
        size: selectedSize,
        qty,
        collectionName: pack.name,
        services,
        customizationNote,
      }];
    });
  };

  return (
    <div className="mt-6 border-t border-neutral-200 pt-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-neutral-400">WHOLESALE ORDER</p>
          <h2 className="mt-1 text-[16px] font-medium">ترکیب سفارش عمده</h2>
        </div>
        <span className="rounded-full bg-[#f6f6f4] px-3 py-1.5 text-[10.5px] num-fa">{fa(lines.length)} ردیف سفارش</span>
      </div>

      <ColourWheel product={product} selected={colourIdx} onSelect={onColourChange} />

      <div className="pdp-price-panel mt-5 rounded-2xl p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] text-neutral-500">قیمت عمده فعلی</p>
            <p className="mt-1 text-[17px] font-medium num-fa">{toman(unitPrice)} <span className="text-[10px] font-normal text-neutral-400">/ عدد</span></p>
          </div>
          <p className="text-[10px] text-neutral-500">فروش فقط به‌صورت <strong className="font-medium">کالکشن آماده</strong></p>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-neutral-200 text-center">
          <div className="py-1"><p className="text-[9px] text-neutral-400 num-fa">۱۲–۲۳ عدد</p><p className="mt-1 text-[10.5px] num-fa">{toman(baseWholesalePrice)}</p></div>
          <div className="py-1"><p className="text-[9px] text-neutral-400 num-fa">۲۴–۴۷ عدد</p><p className="mt-1 text-[10.5px] num-fa">{toman(Math.round(baseWholesalePrice * 0.94 / 10_000) * 10_000)}</p></div>
          <div className="py-1"><p className="text-[9px] text-neutral-400 num-fa">۴۸+ عدد</p><p className="mt-1 text-[10.5px] num-fa">{toman(Math.round(baseWholesalePrice * 0.88 / 10_000) * 10_000)}</p></div>
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-[11.5px] font-medium">انتخاب کالکشن آماده</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {collectionPacks.map((item) => (
            <button key={item.id} type="button" onClick={() => setPackId(item.id)} className={(packId === item.id ? "border-[#011c3a] bg-[#f3f5f7]" : "border-neutral-200 hover:border-[#011c3a]") + " rounded-xl border p-3 text-right transition"} >
              <span className="block text-[11.5px] font-medium">{item.name}</span>
              <span className="mt-1 block text-[10px] text-neutral-500 num-fa">{fa(item.qty)} عدد · {item.mix}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label>
            <span className="mb-1.5 block text-[10px] text-neutral-500">سایز مرجع الگو</span>
            <select value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)} className="h-10 w-full rounded-[10px] border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#011c3a]">
              {product.sizes.map((size) => <option key={size.label} value={size.label} disabled={!size.inStock}>{size.label} {!size.inStock ? "— ناموجود" : ""}</option>)}
            </select>
          </label>
          <button type="button" onClick={addLine} className="storefront-primary-action h-10 self-end rounded-full px-5 text-[11.5px] font-medium">
            افزودن {pack.name}
          </button>
        </div>
        <fieldset className="mt-5 border-t border-neutral-200 pt-4">
          <legend className="text-[11.5px] font-medium">خدمات اختصاصی این کالکشن</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {["لیبل اختصاصی برند", "دوخت لوگوی اختصاصی", "بسته‌بندی اختصاصی", "تگ قیمت و بارکد فروشگاه"].map(service => (
              <label key={service} className="flex items-center gap-2 rounded-[10px] border border-neutral-200 p-3 text-[10.5px]">
                <input type="checkbox" checked={services.includes(service)} onChange={() => setServices(current => current.includes(service) ? current.filter(x => x !== service) : [...current, service])} />
                {service}
              </label>
            ))}
          </div>
          <label className="mt-3 block text-[10px] text-neutral-500">توضیحات تولید، محل لوگو یا مشخصات فایل
            <textarea value={customizationNote} onChange={e => setCustomizationNote(e.target.value)} rows={3} placeholder="مثلاً لوگو روی آستین چپ با نخ سرمه‌ای دوخته شود…" className="mt-1.5 w-full resize-y rounded-[10px] border border-neutral-300 p-3 text-[11px] outline-none focus:border-[#011c3a]" />
          </label>
        </fieldset>
        <p className="mt-3 text-[10px] text-neutral-500 num-fa">جمع این کالکشن: {fa(qty)} عدد · {toman(qty * unitPrice)}</p>
      </div>

      {lines.length > 0 && (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[12.5px] font-medium">پیش‌سفارش کالکشن</h3>
            <Link to="/wholesale?section=catalog" className="text-[10.5px] underline underline-offset-2">افزودن محصول دیگر</Link>
          </div>
          <div className="divide-y divide-neutral-200 border-y border-neutral-200">
            {lines.map((line) => (
              <div key={line.key} className="grid grid-cols-[1fr_auto] gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[11.5px] font-medium">{line.productName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
                    <span className="h-3 w-3 rounded-full border border-neutral-300" style={{ background: line.colourHex }} />
                    <span>{line.colour}</span><span>{line.collectionName ?? `سایز ${line.size}`}</span><span>کد {line.productCode}</span>
                  </div>
                  {line.services?.length ? <p className="mt-1 text-[9.5px] text-neutral-400">خدمات: {line.services.join("، ")}</p> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] font-medium num-fa">{fa(line.qty)} عدد</span>
                  <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} aria-label="حذف ردیف" className="text-[10.5px] text-red-700 underline">حذف</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl bg-[#f6f6f4] p-4 text-[12px]">
            <span>جمع کل کالکشن</span>
            <strong className="text-[17px] font-medium num-fa">{fa(total)} عدد</strong>
          </div>
        </div>
      )}

      {submitted ? (
        <div className="mt-4 rounded-2xl border border-[#011c3a] bg-white p-4 text-center">
          <Icon name="check" className="mx-auto h-5 w-5" strokeWidth={2.3} />
          <p className="mt-2 text-[12.5px] font-medium">پیش‌سفارش برای بررسی ثبت شد</p>
          <p className="mt-1 text-[10.5px] text-neutral-500">کارشناس فروش برای اعلام قیمت و موجودی نهایی با شما تماس می‌گیرد.</p>
        </div>
      ) : (
        <button
          type="button"
          disabled={lines.length === 0}
          onClick={() => setSubmitted(true)}
          className="storefront-primary-action mt-4 h-12 w-full rounded-full text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          ثبت نهایی سفارش کالکشن و دریافت قیمت
        </button>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-[10.5px] text-neutral-500">
        <span>قیمت عمده پس از تأیید حساب همکار نمایش داده می‌شود.</span>
        <Link to="/wholesale?section=form" className="shrink-0 underline underline-offset-2">درخواست حساب همکاری</Link>
      </div>
    </div>
  );
}

/* ------------------------------ راهنمای سایز ------------------------------- */

function SizeGuide({ product, mode }: { product: Product; mode: "chart" | "how" }) {
  return (
    <div className="fade-up mt-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-4 text-[13px] font-medium">{mode === "chart" ? "جدول سایز محصول" : "راهنمای اندازه‌گیری"}</h3>
      {mode === "chart" ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[11.5px]">
              <thead>
                <tr className="border-b border-neutral-300 text-right">
                  <th className="py-2 font-medium">سایز</th>
                  <th className="py-2 font-medium">دور سینه</th>
                  <th className="py-2 font-medium">عرض شانه</th>
                  <th className="py-2 font-medium">قد</th>
                  <th className="py-2 font-medium">قد آستین</th>
                </tr>
              </thead>
              <tbody>
                {product.sizeChart.map((r, i) => (
                  <tr key={r.size} className={i % 2 ? "bg-[#f6f6f4]" : ""}>
                    <td className="py-2 font-medium">{r.size}</td>
                    <td className="py-2 num-fa">{fa(r.chest)}</td>
                    <td className="py-2 num-fa">{fa(r.shoulder)}</td>
                    <td className="py-2 num-fa">{fa(r.length)}</td>
                    <td className="py-2 num-fa">{fa(r.sleeve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            اندازه‌ها بر حسب سانتی‌متر و مربوط به خود لباس است (نه بدن). {product.sizeAdvice}
          </p>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <button onClick={() => window.open("https://www.aparat.com/", "_blank")} className="group relative overflow-hidden rounded-xl bg-neutral-900">
            <img src="/images/flat.jpg" alt="ویدئوی اندازه‌گیری" loading="lazy" className="aspect-[4/3] w-full object-cover opacity-70" />
            <span className="absolute inset-0 flex items-center justify-center text-white">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/70">
                <Icon name="play" className="mr-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
              </span>
            </span>
          </button>
          <ol className="space-y-2.5 text-[11.5px] leading-relaxed text-neutral-600">
            {[
              "دور سینه: متر را از پرترین قسمت سینه و زیر بغل عبور دهید، بدون فشار.",
              "عرض شانه: از انتهای استخوان یک شانه تا انتهای شانه دیگر، از پشت.",
              "قد لباس: از بالای سرشانه تا پایین‌ترین نقطه لباس.",
              "قد آستین: از وسط پشت گردن، روی شانه و تا مچ، با آرنج کمی خم.",
            ].map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#011c3a] text-[9px] text-white">
                  {fa(i + 1)}
                </span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- نظرات ---------------------------------- */

function Reviews({ product }: { product: Product }) {
  const dist = [5, 4, 3, 2, 1].map((s) => ({
    stars: s,
    count: product.reviews.filter((r) => r.stars === s).length,
  }));
  const max = Math.max(1, ...dist.map((d) => d.count));

  const bars = [
    { label: "سایز", value: "مطابق انتظار", pos: 50 },
    { label: "کیفیت دوخت", value: "عالی", pos: 94 },
    { label: "کیفیت پارچه", value: "عالی", pos: 91 },
    { label: "ارزش خرید", value: "خوب", pos: 84 },
  ];

  return (
    <section id="reviews" className="product-reviews scroll-mt-[84px] border-t border-neutral-200 lg:scroll-mt-[170px]">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-12 lg:px-8 lg:py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.3em] text-neutral-400">CUSTOMER REVIEWS</p>
            <h2 className="mt-2 text-[20px] font-medium">نظرات مشتریان</h2>
          </div>
          <p className="text-[11.5px] text-neutral-500 num-fa">بر اساس {fa(product.reviewCount)} خرید ثبت‌شده</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr] lg:gap-6">
          <div className="review-summary liquid-panel">
            <div className="flex items-end gap-3">
              <span className="text-[44px] font-light leading-none num-fa">{fa(product.rating)}</span>
              <div className="pb-1">
                <Stars value={product.rating} size={14} />
                <p className="mt-1 text-[11px] text-neutral-500">از {fa(product.reviewCount)} نظر</p>
              </div>
            </div>

            <div className="mt-5 space-y-1.5">
              {dist.map((d) => (
                <div key={d.stars} className="flex items-center gap-2 text-[11px]">
                  <span className="w-8 num-fa">{fa(d.stars)} ★</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <div className="review-meter-fill h-full" style={{ width: `${(d.count / max) * 100}%` }} />
                  </div>
                  <span className="w-6 text-left text-neutral-400 num-fa">{fa(d.count)}</span>
                </div>
              ))}
            </div>

            <div className="mt-7 space-y-4">
              {bars.map((b) => (
                <div key={b.label}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-600">{b.label}</span>
                    <span className="text-neutral-500">{b.value}</span>
                  </div>
                  <div className="relative mt-1.5 h-[3px] rounded-full bg-neutral-200">
                    <div className="review-marker absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ right: `calc(${b.pos}% - 5px)` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="review-list liquid-panel divide-y divide-neutral-200">
            {product.reviews.map((r, i) => (
              <article key={i} className="py-5 first:pt-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Stars value={r.stars} />
                    <h4 className="mt-2 text-[13px] font-medium">{r.title}</h4>
                  </div>
                  <span className="shrink-0 text-[11px] text-neutral-400">{r.date}</span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-600">{r.text}</p>
                <p className="mt-2.5 text-[11px] text-neutral-500">
                  {r.author} — سایز {r.size} — فیت: {r.fit}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- صفحه ------------------------------------ */

export default function ProductPage({ id }: { id: string }) {
  const { query } = useRouter();
  const wholesale = query.get("wholesale") === "1";
  const product = productById(id);
  const { addToCart, toggleWish, isWished, toggleCompare, compare } = useStore();
  const { builder } = useSiteSettings();

  const [colourIdx, setColourIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState(false);
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [openAcc, setOpenAcc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [sticky, setSticky] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sizeAdvisorOpen, setSizeAdvisorOpen] = useState(false);
  const [stickySizeOpen, setStickySizeOpen] = useState(false);
  const [stickyColourOpen, setStickyColourOpen] = useState(false);
  const [subnavVisible, setSubnavVisible] = useState(false);
  const [activeSection, setActiveSection] = useState("details");
  const actionsRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  const lookSettings = builder.look;

  /* ست اختصاصی محصول از پنل ادمین: عکس محصول روی تن مدل + هات‌اسپات مکملها */
  const adminLook = (product as AdminProductRecord).admin?.look;
  const productLookHotspots = (adminLook?.hotspots ?? []).filter((h) => h.visible && h.productId);
  const productLookImage = adminLook?.image || product.images[0] || "";

  useEffect(() => {
    setColourIdx(0);
    setSize(null);
    setSizeError(false);
    setAdded(false);
    setActiveImage(0);
    setOpenAcc(null);
    setSizeAdvisorOpen(false);
    setStickySizeOpen(false);
    setStickyColourOpen(false);
  }, [id]);

  /* نوار خرید چسبان: فقط وقتی دکمهٔ اصلی از دید خارج شد */
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = actionsRef.current;
        if (el) setSticky(el.getBoundingClientRect().bottom < 90);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [id]);

  /* زیرمنوی بخش‌ها + هایلایت بخش فعال */
  const sections = [
    { id: "details", label: "جزئیات و مشخصات" },
    ...(lookSettings.enabled ? [{ id: "look", label: "با این ست کنید" }] : []),
    { id: "reviews", label: "نظرات" },
    { id: "related", label: "محصولات مشابه" },
  ];

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hero = heroRef.current;
        if (hero) setSubnavVisible(hero.getBoundingClientRect().bottom < 170);
        const y = window.scrollY + 260;
        let current = sections[0]?.id ?? "details";
        for (const s of sections) {
          const el = document.getElementById(s.id);
          if (el && el.offsetTop <= y) current = s.id;
        }
        setActiveSection(current);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lookSettings.enabled]);

  if (!product) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-[14px]">محصول یافت نشد.</p>
        <Link to="/shop" className="storefront-primary-action rounded-full px-6 py-2.5 text-[12.5px] font-medium">
          بازگشت به فروشگاه
        </Link>
      </div>
    );
  }

  const colour = product.colours[colourIdx];
  const wished = isWished(product.id);
  const inCompare = compare.includes(product.id);
  const inStockCount = product.sizes.filter((s) => s.inStock).length;

  const handleColour = (i: number) => {
    setColourIdx(i);
    /* همگام‌سازی گالری با رنگ انتخاب‌شده */
    const img = product.colours[i]?.img;
    if (img) {
      const idx = product.images.indexOf(img);
      if (idx >= 0) setActiveImage(idx + (product.video ? 1 : 0));
    }
  };

  const pickSize = (label: string) => {
    setSize(label);
    setSizeError(false);
  };

  const handleAdd = () => {
    if (!size) {
      setSizeError(true);
      document.getElementById("size-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    addToCart({
      id: product.id,
      name: product.name,
      colour: colour.name,
      size,
      price: product.price,
      img: colour.img,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: product.name, url });
        return;
      } catch {
        /* کاربر لغو کرد */
      }
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const accordions = [
    { title: "جنس و مراقبت", body: `${product.specs.fibre}. ${product.specs.care}. وزن پارچه: ${product.specs.weight}.` },
    { title: "سایز و فیت", body: product.sizeAdvice },
    { title: "ارسال و مرجوعی", body: "سفارش‌های ثبت‌شده تا ساعت ۱۴ همان روز کاری ارسال می‌شوند. ارسال برای سفارش‌های بالای ۳ میلیون تومان رایگان است. تا ۳۰ روز فرصت دارید محصول را مرجوع یا تعویض کنید." },
  ];

  const related = product.relatedIds.map(productById).filter(Boolean) as Product[];
  const complementary = product.complementaryIds.map(productById).filter(Boolean) as Product[];

  return (
    <>
      <main>
        {wholesale && (
          <div className="flex items-center justify-between gap-4 bg-[#011c3a] px-4 py-3 text-white lg:px-8">
            <div>
              <p className="text-[10px] tracking-[0.25em] text-white/55">WHOLESALE CATALOG</p>
              <p className="mt-0.5 text-[12px]">مشاهده محصول در حالت سفارش عمده</p>
            </div>
            <Link to="/wholesale?section=catalog" className="shrink-0 text-[11.5px] underline underline-offset-4">بازگشت به کاتالوگ</Link>
          </div>
        )}

        {/* ═══════════════ ناحیهٔ اصلی: گالری (راست) + باکس خرید (چپ) ═══════════════ */}
        <div ref={heroRef} className="mx-auto w-full max-w-[1360px] px-4 sm:px-6 lg:px-8">
          {/* بردکرامب — جهت‌یابی */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 py-3 text-[11px] text-neutral-500">
            <Link to="/" className="hover:underline">خانه</Link>
            <span className="text-neutral-300">›</span>
            {wholesale ? (
              <Link to="/wholesale?section=catalog" className="hover:underline">کاتالوگ عمده</Link>
            ) : (
              <Link to={`/shop?cat=${product.category}`} className="hover:underline">{product.categoryLabel}</Link>
            )}
            <span className="text-neutral-300">›</span>
            <span className="truncate text-[#011c3a]">{product.name}</span>
          </nav>

          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-10 xl:gap-14">
            {/* گالری — ستون راست (نقطهٔ شروع خواندن در RTL) و چسبان */}
            <div className="lg:sticky lg:top-[122px] lg:self-start">
              <Gallery product={product} onOpen={(i) => setLightbox(i)} activeImage={activeImage} setActiveImage={setActiveImage} />
            </div>

            {/* باکس خرید — ستون چپ */}
            <div className="pb-8 pt-5 lg:pb-10 lg:pt-1">
              {/* ۱ — شناسنامهٔ محصول */}
              <header>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <div className="flex min-w-0 items-center gap-1.5 text-neutral-500">
                    <span className="truncate">{product.fabricGroup} · {product.season}</span>
                  </div>
                  <span className="shrink-0 text-[10px] tracking-wide text-neutral-400" dir="ltr">{product.specs.code}</span>
                </div>
                <h1 className="mt-2.5 text-[23px] font-semibold leading-snug lg:text-[26px]">{product.name}</h1>
                <p className="mt-1 text-[10.5px] tracking-[0.22em] text-neutral-400" dir="ltr">{product.latin.toUpperCase()}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px]">
                  <a href="#reviews" className="flex items-center gap-1.5 hover:underline">
                    <Stars value={product.rating} size={13} />
                    <span className="text-neutral-500 num-fa">{fa(product.rating)} ({fa(product.reviewCount)} نظر)</span>
                  </a>
                  <span className="hidden h-3 w-px bg-neutral-300 sm:block" />
                  <span className="text-neutral-500 num-fa">{fa(product.sold)}+ فروش موفق</span>
                </div>
              </header>

              {wholesale ? (
                <WholesaleOrderPanel product={product} colourIdx={colourIdx} onColourChange={handleColour} />
              ) : (
                <>
                  {/* ۲ — قیمت (نزدیک به اقدام) */}
                  <div className="pdp-price-panel mt-5 flex flex-wrap items-end justify-between gap-3 rounded-2xl p-4">
                    <div>
                      <p className="text-[10.5px] text-neutral-500">قیمت محصول</p>
                      <p className="mt-1 text-[23px] font-semibold leading-none num-fa">{toman(product.price)}</p>
                    </div>
                    <p className="flex items-center gap-1.5 text-[10.5px] text-neutral-500">
                      <Icon name="truck" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      ارسال رایگان بالای ۳ میلیون تومان
                    </p>
                  </div>

                  {/* ۳ — انتخاب رنگ */}
                  <div className="mt-6">
                    <ColourWheel product={product} selected={colourIdx} onSelect={handleColour} />
                  </div>

                  {/* ۴ — انتخاب سایز */}
                  <div id="size-picker" className="mt-6 scroll-mt-24">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium">
                        انتخاب سایز
                        {size && <span className="mr-1.5 font-normal text-neutral-500">— {size}</span>}
                      </span>
                      <div className="flex items-center gap-3 text-[11.5px]">
                        <button onClick={() => setOpenAcc(openAcc === "size-chart" ? null : "size-chart")} className="underline underline-offset-2 hover:text-[#011c3a]">جدول سایز</button>
                        <span className="h-3 w-px bg-neutral-300" />
                        <button onClick={() => setOpenAcc(openAcc === "size-guide" ? null : "size-guide")} className="underline underline-offset-2 hover:text-[#011c3a]">راهنمای اندازه‌گیری</button>
                      </div>
                    </div>

                    <div className={`mt-3 flex flex-wrap gap-2 ${sizeError ? "pdp-error-box" : ""}`} role="group" aria-label="انتخاب سایز">
                      {product.sizes.map((s) => (
                        <button
                          key={s.label}
                          onClick={() => s.inStock && pickSize(s.label)}
                          disabled={!s.inStock}
                          aria-pressed={size === s.label}
                          title={s.inStock ? s.label : "ناموجود"}
                          className={
                            "pdp-size-pill relative " +
                            (!s.inStock
                              ? "is-unavailable cursor-not-allowed"
                              : size === s.label
                                ? "is-selected"
                                : "hover:border-[#011c3a]")
                          }
                        >
                          {s.label}
                          {!s.inStock && (
                            <svg viewBox="0 0 48 48" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                              <line x1="4" y1="44" x2="44" y2="4" stroke="#c9c9c9" strokeWidth="1.5" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>

                  {/* هشدارها و راهنما */}
                  {sizeError && (
                    <p className="pdp-error-text mt-2 text-[11px]">برای افزودن به سبد، ابتدا یک سایز انتخاب کنید.</p>
                  )}
                  {!sizeError && inStockCount > 0 && inStockCount <= 2 && (
                    <p className="pdp-hint-warn mt-2 flex items-center gap-1.5 text-[11px]">
                      <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={1.6} />
                      موجودی محدود — تنها {fa(inStockCount)} سایز باقی مانده است
                    </p>
                  )}
                    {openAcc === "size-chart" && <SizeGuide product={product} mode="chart" />}
                    {openAcc === "size-guide" && <SizeGuide product={product} mode="how" />}
                  </div>

                  {/* ۵ — دکمهٔ اصلی خرید */}
                  <div ref={actionsRef} className="mt-5">
                    <div className="flex gap-2">
                      <button
                        onClick={handleAdd}
                        className="storefront-primary-action flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[13.5px] font-medium"
                      >
                        <Icon name={added ? "check" : "bag"} className="h-[18px] w-[18px]" strokeWidth={added ? 2.4 : 1.8} />
                        {added ? "به سبد اضافه شد" : size ? "افزودن به سبد خرید" : "یک سایز انتخاب کنید"}
                      </button>
                      <button
                        onClick={() => toggleWish(product.id)}
                        aria-label={wished ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
                        aria-pressed={wished}
                        className="storefront-icon-action flex h-[52px] w-[52px] items-center justify-center rounded-full"
                      >
                        <Icon name="heart" className="h-[18px] w-[18px]" fill={wished ? "#011c3a" : "none"} />
                      </button>
                    </div>

                    {/* ۶ — اقدامات کمکی */}
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => toggleCompare(product.id)}
                        aria-pressed={inCompare}
                        className={"storefront-secondary-action flex h-10 items-center justify-center gap-2 rounded-full text-[12px] " + (inCompare ? "is-active" : "")}
                      >
                        {inCompare ? "در لیست مقایسه" : "مقایسه"}
                      </button>
                      <button onClick={share} className="storefront-secondary-action flex h-10 items-center justify-center gap-2 rounded-full text-[12px]">
                        {copied ? "لینک کپی شد ✓" : "اشتراک‌گذاری"}
                      </button>
                    </div>

                    {/* ۷ — خدمات هوشمند */}
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <button onClick={() => setSizeAdvisorOpen(true)} className="size-advisor-trigger storefront-secondary-action flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-[11.5px] font-medium">
                        <Icon name="user" className="h-4 w-4" /> پیشنهاد هوشمند سایز
                      </button>
                      <Link to={`/try-on?top=${product.id}`} className="ai-tryon-button flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-[11.5px] font-medium">
                        <Icon name="star" className="h-4 w-4" /> Try On Me
                      </Link>
                    </div>
                  </div>

                  {/* ۸ — نشان‌های اعتماد */}
                  <ul className="pdp-trust-strip mt-5 rounded-2xl">
                    {[
                      { icon: "truck", title: "ارسال سریع و بیمه‌شده", text: "تهران ۱ تا ۲ روز کاری، سایر شهرها ۲ تا ۴ روز کاری" },
                      { icon: "return", title: "۳۰ روز مهلت مرجوعی", text: "تعویض سایز یا مرجوعی کامل، بدون قید و شرط" },
                      { icon: "needle", title: "دوخت دست کلبه", text: "تولید در کارگاه خودمان + ضمانت تعمیرات یک‌ساله" },
                    ].map((t) => (
                      <li key={t.title} className="flex items-center gap-3 px-4 py-3">
                        <span className="pdp-icon-bubble flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                          <Icon name={t.icon} className="h-4 w-4" strokeWidth={1.4} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium">{t.title}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{t.text}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════════ زیرمنوی چسبان بخش‌ها (دسکتاپ) ═══════════════ */}
        <nav
          aria-label="بخش‌های صفحه محصول"
          className={`pdp-subnav sticky top-[108px] z-40 hidden border-y transition-all duration-300 lg:block ${subnavVisible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"}`}
        >
          <div className="mx-auto flex w-full max-w-[1360px] items-center gap-7 px-8">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`pdp-subnav-link border-b-2 py-3 text-[12px] transition ${activeSection === s.id ? "is-active" : ""}`}
              >
                {s.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="mr-auto py-3 text-[11.5px] text-neutral-500 underline-offset-4 transition hover:text-[#011c3a] hover:underline"
            >
              ↑ بازگشت به خرید
            </button>
          </div>
        </nav>

        {/* ═══════════════ جزئیات محصول + مشخصات فنی ═══════════════ */}
        <section id="details" className="scroll-mt-[84px] border-t border-neutral-200 lg:scroll-mt-[170px]">
          <div className="mx-auto w-full max-w-[1360px] px-4 py-12 lg:px-8 lg:py-16">
            <header>
              <p className="text-[10px] tracking-[0.3em] text-neutral-400">PRODUCT DETAILS</p>
              <h2 className="mt-2 text-[20px] font-medium">جزئیات محصول</h2>
            </header>

            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12 xl:gap-16">
              {/* راست: توضیحات + ویژگی‌ها + آکاردئون‌ها */}
              <div>
                <p className="text-[13px] leading-[2.1] text-neutral-600">{product.description}</p>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {[
                    { icon: "needle", title: "دوخت دست", text: "هر قطعه در کارگاه کلبه و با نظارت خیاط ارشد دوخته می‌شود." },
                    { icon: "shield", title: "ضمانت کیفیت", text: "تا یک سال پس از خرید، تعمیرات دوخت رایگان است." },
                  ].map((f) => (
                    <div key={f.title} className="pdp-feature-card flex gap-3 rounded-2xl p-4">
                      <div className="pdp-icon-bubble flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                        <Icon name={f.icon} className="h-4 w-4" strokeWidth={1.3} />
                      </div>
                      <div>
                        <p className="text-[12px] font-medium">{f.title}</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{f.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-7 border-t border-neutral-200">
                  {accordions.map((a) => (
                    <div key={a.title} className="border-b border-neutral-200">
                      <button onClick={() => setOpenAcc(openAcc === a.title ? null : a.title)} aria-expanded={openAcc === a.title} className="flex w-full items-center justify-between py-3.5 text-right text-[13px]">
                        {a.title}
                        <Icon name={openAcc === a.title ? "minus" : "plus"} className="h-3.5 w-3.5 text-neutral-400" />
                      </button>
                      {openAcc === a.title && (
                        <p className="pb-4 text-[12.5px] leading-[2] text-neutral-600">{a.body}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* چپ: جدول مشخصات فنی */}
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-medium">مشخصات فنی</h3>
                  <span className="text-[10.5px] text-neutral-400" dir="ltr">{product.specs.code}</span>
                </div>
                <div className="product-specs-table mt-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {specOrder.map((key, i) => (
                        <tr key={key} className={"product-spec-row grid grid-cols-[38%_62%] gap-x-4 px-4 py-3 " + (i % 2 === 0 ? "" : "is-alt")}>
                          <th className="text-right font-medium text-neutral-500">{specLabels[key]}</th>
                          <td className="text-right">{product.specs[key]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ با این ست کنید — ست اختصاصی محصول (هات‌اسپات مکملها) ═══════════════ */}
        {productLookHotspots.length > 0 && (
          <section id="look" className="scroll-mt-[84px] border-t border-neutral-200 bg-[#f6f6f4] lg:scroll-mt-[170px]">
            <div className="mx-auto w-full max-w-[1360px] px-4 py-12 lg:px-8 lg:py-16">
              <div className="mb-8">
                <p className="text-[11px] tracking-[0.3em] text-neutral-400">COMPLETE THE LOOK</p>
                <h2 className="mt-2 text-[20px] font-medium">با این ست کنید</h2>
                <p className="mt-2 text-[12.5px] text-neutral-500">
                  {product.name} روی تن مدل، همراه با قطعات مکمل پیشنهادی استایلیست‌های کلبه — روی نقاط رنگی بزنید.
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
                {/* عکس خودِ همین محصول روی تن مدل + هات‌اسپاتهای مکمل */}
                <div className="relative overflow-hidden rounded-2xl bg-neutral-100">
                  <img src={productLookImage} alt={`${product.name} — ست پیشنهادی`} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  {productLookHotspots.map((h) => {
                    const linked = productById(h.productId);
                    if (!linked) return null;
                    return (
                      <Link key={h.id} to={`/product/${linked.id}`} className="group/hot absolute z-10" style={{ right: `${h.x}%`, top: `${h.y}%` }} aria-label={`مشاهده ${linked.name}`}>
                        <span className="block h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white shadow-md transition group-hover/hot:scale-125" style={{ background: h.color }} />
                        <span className="pointer-events-none absolute right-1/2 top-3 translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[9.5px] font-medium text-white opacity-0 shadow-md transition group-hover/hot:opacity-100" style={{ background: h.color }}>
                          {linked.name} · {toman(linked.price)}
                        </span>
                      </Link>
                    );
                  })}
                </div>

                {/* کارتهای مکمل کنار عکس */}
                <div>
                  <h3 className="text-[16px] font-medium">قطعات مکمل این ست</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {complementary.map((p) => (
                      <Link key={p.id} to={`/product/${p.id}`} className="group block overflow-hidden rounded-2xl bg-white">
                        <div className="overflow-hidden bg-neutral-100">
                          <img src={p.images[0]} alt={p.name} loading="lazy" className="aspect-[3/4] w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                        </div>
                        <div className="p-3">
                          <p className="truncate text-[12px] font-medium">{p.name}</p>
                          <p className="mt-1 text-[11.5px] text-neutral-500 num-fa">{toman(p.price)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════ با این ست کنید (سراسری — کنترل‌شده از سایت‌ساز) ═══════════════ */}
        {lookSettings.enabled && productLookHotspots.length === 0 && (
          <section id="look" className="scroll-mt-[84px] border-t border-neutral-200 bg-[#f6f6f4] lg:scroll-mt-[170px]">
            <div className="mx-auto w-full max-w-[1360px] px-4 py-12 lg:px-8 lg:py-16">
              <div className="mb-8">
                <p className="text-[11px] tracking-[0.3em] text-neutral-400">COMPLETE THE LOOK</p>
                <h2 className="mt-2 text-[20px] font-medium">با این ست کنید</h2>
                <p className="mt-2 text-[12.5px] text-neutral-500">{lookSettings.subtitle}</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
                <div className="relative overflow-hidden rounded-2xl bg-neutral-100">
                  <img src={lookSettings.image} alt={lookSettings.title} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  {lookSettings.hotspots.filter((h) => h.visible).map((h) => (
                    <span key={h.id} className="group/hot absolute z-10" style={{ right: `${h.x}%`, top: `${h.y}%` }}>
                      <span className="block h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white shadow-md transition group-hover/hot:scale-125" style={{ background: h.color }} />
                      <span className="pointer-events-none absolute right-1/2 top-3 translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[9.5px] font-medium text-white opacity-0 shadow-md transition group-hover/hot:opacity-100" style={{ background: h.color }}>{h.label}</span>
                    </span>
                  ))}
                </div>

                <div>
                  <h3 className="text-[16px] font-medium">{lookSettings.title}</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {(lookSettings.products.length > 0 ? lookSettings.products : []).map((lp) => (
                      <Link key={lp.id} to={lp.to || "/shop"} className="group block overflow-hidden rounded-2xl bg-white">
                        <div className="overflow-hidden bg-neutral-100">
                          <img src={lp.img} alt={lp.name} loading="lazy" className="aspect-[3/4] w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                        </div>
                        <div className="p-3">
                          <p className="truncate text-[12px] font-medium">{lp.name}</p>
                          <p className="mt-1 text-[11.5px] text-neutral-500 num-fa">{toman(lp.price)}</p>
                        </div>
                      </Link>
                    ))}
                    {lookSettings.products.length === 0 && complementary.map((p) => (
                      <ProductCard key={p.id} product={p} compact />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════ نظرات مشتریان ═══════════════ */}
        <Reviews product={product} />

        {/* ═══════════════ محصولات مشابه ═══════════════ */}
        <section id="related" className="scroll-mt-[84px] lg:scroll-mt-[170px]">
          <div className="mx-auto w-full max-w-[1360px] px-4 py-12 lg:px-8 lg:py-16">
            <div className="mb-6 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] tracking-[0.3em] text-neutral-400">YOU MAY ALSO LIKE</p>
                <h2 className="mt-2 text-[20px] font-medium">محصولات مشابه</h2>
              </div>
              <Link to={`/shop?cat=${product.category}`} className="shrink-0 text-[11.5px] text-neutral-500 underline underline-offset-4 hover:text-[#011c3a]">
                مشاهده همه
              </Link>
            </div>
            <div className="rtl-rail no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:px-0">
              {related.map((p) => (
                <div key={p.id} className="w-[62%] shrink-0 sm:w-[38%] lg:w-[23.5%]">
                  <ProductCard product={p} />
                </div>
              ))}
              {products
                .filter((p) => p.style === product.style && p.id !== product.id && !product.relatedIds.includes(p.id))
                .slice(0, 2)
                .map((p) => (
                  <div key={p.id} className="w-[62%] shrink-0 sm:w-[38%] lg:w-[23.5%]">
                    <ProductCard product={p} />
                  </div>
                ))}
            </div>
          </div>
        </section>

        {/* فاصله برای نوار خرید چسبان */}
        {sticky && !wholesale && <div className="h-24" aria-hidden="true" />}
      </main>

      {/* ═══════════════ نوار خرید چسبان ═══════════════ */}
      {!wholesale && sticky &&
        createPortal(
          <div className="product-sticky-purchase liquid-surface sticky-purchase-in fixed inset-x-0 bottom-0 z-[90] border-t border-neutral-200 bg-white/97 px-3 py-2.5 shadow-[0_-8px_25px_rgba(1,28,58,0.09)] backdrop-blur sm:px-5">
            <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 sm:gap-4">
              <img src={colour.img} alt="" className="hidden h-12 w-9 shrink-0 rounded-lg object-cover sm:block" />
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-[12.5px] font-medium">{product.name}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {colour.name} {size ? `— سایز ${size}` : ""}
                </p>
              </div>
              <span className="mr-auto shrink-0 text-[13px] font-medium num-fa">{toman(product.price)}</span>

              {/* انتخاب رنگ — کالر پیکر داخل نوار چسبان */}
              <div className="sticky-colour-picker relative shrink-0">
                <button
                  type="button"
                  onClick={() => { setStickyColourOpen((open) => !open); setStickySizeOpen(false); }}
                  aria-haspopup="listbox"
                  aria-expanded={stickyColourOpen}
                  aria-label={`رنگ: ${colour.name} — تغییر رنگ`}
                  title={colour.name}
                  className="storefront-secondary-action flex h-10 items-center justify-center gap-2 rounded-full px-3"
                >
                  <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: colour.hex }} />
                  <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${stickyColourOpen ? "rotate-180" : ""}`} />
                </button>
                {stickyColourOpen && (
                  <div role="listbox" aria-label="انتخاب رنگ خرید" className="sticky-colour-menu liquid-surface absolute left-0 border">
                    {product.colours.map((c, i) => (
                      <button
                        key={c.name}
                        type="button"
                        role="option"
                        aria-selected={i === colourIdx}
                        aria-label={c.name}
                        title={c.name}
                        onClick={() => { handleColour(i); setStickyColourOpen(false); }}
                        className={`pdp-swatch flex items-center justify-center rounded-full ${i === colourIdx ? "is-selected" : ""}`}
                      >
                        <span className="relative flex h-6 w-6 items-center justify-center rounded-full border border-black/10" style={{ backgroundColor: c.hex }}>
                          {i === colourIdx && <Icon name="check" className="h-3 w-3 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" strokeWidth={3} />}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="sticky-size-picker relative shrink-0">
                <button
                  type="button"
                  onClick={() => { setStickySizeOpen((open) => !open); setStickyColourOpen(false); }}
                  aria-haspopup="listbox"
                  aria-expanded={stickySizeOpen}
                  className="storefront-secondary-action flex h-10 min-w-[82px] items-center justify-between gap-2 rounded-full px-3 text-[12px]"
                >
                  {size ?? "سایز"}
                  <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${stickySizeOpen ? "rotate-180" : ""}`} />
                </button>
                {stickySizeOpen && (
                  <div role="listbox" aria-label="انتخاب سایز خرید" className="sticky-size-menu liquid-surface absolute bottom-12 left-0 grid min-w-[156px] grid-cols-3 gap-1.5 rounded-2xl border p-2">
                    {product.sizes.filter((item) => item.inStock).map((item) => (
                      <button
                        key={item.label}
                        role="option"
                        aria-selected={size === item.label}
                        onClick={() => { pickSize(item.label); setStickySizeOpen(false); }}
                        className={`h-9 rounded-xl text-[11px] ${size === item.label ? "storefront-primary-action" : "storefront-secondary-action"}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleAdd}
                className="storefront-primary-action flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-4 text-[12px] font-medium sm:w-[220px] sm:flex-none sm:text-[13px]"
              >
                <Icon name={added ? "check" : "bag"} className="h-4 w-4 shrink-0" />
                {added ? "اضافه شد" : "افزودن به سبد"}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* ═══════════════ مودال پیشنهاد هوشمند سایز ═══════════════ */}
      {sizeAdvisorOpen &&
        createPortal(
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="size-advisor-title">
            <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setSizeAdvisorOpen(false)} aria-label="بستن پیشنهاد سایز" />
            <div className="size-advisor-modal liquid-surface relative max-h-[calc(100dvh-2rem)] w-full max-w-[620px] overflow-y-auto rounded-[1.75rem] border p-3 sm:p-4">
              <div className="flex items-center justify-between px-2 pb-3">
                <div>
                  <p className="text-[9px] tracking-[0.2em] text-neutral-400">SMART FIT</p>
                  <h2 id="size-advisor-title" className="mt-1 text-[15px] font-medium">استایل‌ساز و پیشنهاد سایز</h2>
                </div>
                <button onClick={() => setSizeAdvisorOpen(false)} className="storefront-icon-action flex h-10 w-10 items-center justify-center rounded-full border" aria-label="بستن">
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
              <SizeAdvisor product={product} onPick={(pickedSize) => { pickSize(pickedSize); setSizeAdvisorOpen(false); }} />
            </div>
          </div>,
          document.body,
        )}

      {lightbox !== null && (
        <Lightbox images={product.images} start={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}
