import { useSiteSettings } from "../siteSettings";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouter } from "../router";
import { productById, products, specLabels, specOrder, type Product } from "../data/catalog";
import { looks } from "../siteData";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import Icon from "../components/Icon";
import Lightbox from "../components/Lightbox";
import SizeAdvisor from "../components/SizeAdvisor";
import ProductCard from "../components/ProductCard";

/* --------------------------------- ستاره‌ها --------------------------------- */

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="product-stars inline-flex items-center gap-[1px]">
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

function Check() {
  return <Icon name="check" className="mt-[3px] h-3 w-3 shrink-0" strokeWidth={2.6} />;
}

/* --------------------------------- گالری ----------------------------------- */

function ZoomImage({
  src,
  alt,
  onOpen,
  figureClassName = "",
  imgClassName = "aspect-[4/5] max-h-[720px]",
}: {
  src: string;
  alt: string;
  onOpen: () => void;
  figureClassName?: string;
  imgClassName?: string;
}) {
  const [zoom, setZoom] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  return (
    <figure
      className={"product-gallery-media relative cursor-zoom-in overflow-hidden bg-neutral-100 " + figureClassName}
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
        className={"w-full object-contain transition-transform duration-300 " + imgClassName}
        style={{ transform: zoom ? "scale(1.7)" : "scale(1)", transformOrigin: `${pos.x}% ${pos.y}%` }}
      />
    </figure>
  );
}

function Gallery({ product, onOpen }: { product: Product; onOpen: (i: number) => void }) {
  const media = product.images;
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
      {/* موبایل: اسلایدر لمسی همراه تامنیل و فلش */}
      <div className="product-gallery-mobile relative lg:hidden">
        <div ref={mobileRailRef} onScroll={updateActiveMobileMedia} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto">
          {media.map((src, i) => (
            <button key={src} type="button" className="w-full shrink-0 snap-center" onClick={() => onOpen(i)} aria-label={`نمایش تصویر ${fa(i + 1)} از ${fa(media.length)}`}>
              <img src={src} alt={`${product.name} — تصویر ${fa(i + 1)}`} loading={i === 0 ? "eager" : "lazy"} className="product-gallery-media h-[46svh] max-h-[440px] min-h-[300px] w-full bg-neutral-100 px-5 object-contain" />
            </button>
          ))}
          {product.video && (
            <button type="button" onClick={() => window.open(product.video!.url, "_blank")} className="relative w-full shrink-0 snap-center" aria-label={product.video.title}>
              <img src={product.video.poster} alt={product.video.title} loading="lazy" className="h-[40svh] max-h-[360px] min-h-[260px] w-full bg-neutral-100 px-5 object-contain brightness-75" />
              <span className="absolute inset-0 flex items-center justify-center text-white"><span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70"><Icon name="play" className="mr-1 h-5 w-5" fill="currentColor" strokeWidth={0} /></span></span>
            </button>
          )}
        </div>

        {mobileMediaCount > 1 && (
          <>
            <button type="button" onClick={() => goToMobileMedia(activeMobileMedia - 1)} disabled={activeMobileMedia === 0} aria-label="تصویر قبلی" className="product-gallery-arrow gallery-arrow-pulse absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-white/80 text-[#011c3a] backdrop-blur-sm disabled:opacity-25">
              <Icon name="chevronRight" className="h-5 w-5" strokeWidth={1.6} />
            </button>
            <button type="button" onClick={() => goToMobileMedia(activeMobileMedia + 1)} disabled={activeMobileMedia === mobileMediaCount - 1} aria-label="تصویر بعدی" className="product-gallery-arrow gallery-arrow-pulse absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-white/80 text-[#011c3a] backdrop-blur-sm disabled:opacity-25">
              <Icon name="chevronLeft" className="h-5 w-5" strokeWidth={1.6} />
            </button>
          </>
        )}

        <div className="product-gallery-thumbs no-scrollbar flex gap-2 overflow-x-auto border-b border-neutral-200 bg-white px-4 py-3" aria-label="تصاویر کوچک محصول">
          {media.map((src, i) => (
            <button key={src} type="button" onClick={() => goToMobileMedia(i)} aria-label={`رفتن به تصویر ${fa(i + 1)}`} aria-current={activeMobileMedia === i ? "true" : undefined} className={(activeMobileMedia === i ? "border-[#011c3a]" : "border-transparent opacity-55") + " h-14 w-11 shrink-0 overflow-hidden border-2 transition"}>
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
          {product.video && (
            <button type="button" onClick={() => goToMobileMedia(media.length)} aria-label="رفتن به ویدئوی محصول" aria-current={activeMobileMedia === media.length ? "true" : undefined} className={(activeMobileMedia === media.length ? "border-[#011c3a]" : "border-transparent opacity-55") + " relative h-14 w-11 shrink-0 overflow-hidden border-2 transition"}>
              <img src={product.video.poster} alt="" className="h-full w-full object-cover brightness-75" />
              <Icon name="play" className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white" fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>
      </div>

      {/* دسکتاپ/تبلت: گالری عمودی — هر تصویر تمامعرض، اسکرول عمودی */}
      <div className="product-gallery-grid hidden flex-col gap-3 p-3 sm:flex lg:mx-auto lg:max-w-[900px]">
        {/* ویدیو محصول (اگر موجود) — اول */}
        {product.video && (
          <button
            onClick={() => window.open(product.video!.url, "_blank")}
            className="group relative overflow-hidden rounded-[0.8rem] bg-neutral-900"
          >
            <img
              src={product.video.poster}
              alt={product.video.title}
              className="aspect-[3/4] w-full object-cover opacity-75 transition group-hover:opacity-65"
            />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70">
                <Icon name="play" className="mr-1 h-5 w-5" fill="currentColor" strokeWidth={0} />
              </span>
              <span className="text-[11.5px]">{product.video.title}</span>
            </span>
          </button>
        )}

        {/* همه تصاویر: تمامعرض و پشت سر هم */}
        {media.map((src, i) => (
          <ZoomImage
            key={src + i}
            src={src}
            alt={`${product.name} — تصویر ${fa(i + 1)}`}
            onOpen={() => onOpen(i)}
            figureClassName=""
            imgClassName="aspect-[3/4]"
          />
        ))}
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
        <p className="text-[12px] font-medium">انتخاب رنگ</p>
        <p className="text-[11px] text-neutral-500"><span className="text-[#011c3a]">{sel.name}</span> · {fa(n)} رنگ</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-3" role="radiogroup" aria-label="انتخاب رنگ محصول">
        {product.colours.map((c, i) => (
          <button key={c.name} type="button" role="radio" aria-checked={i === selected} aria-label={c.name} title={c.name} onClick={() => onSelect(i)} className={(i === selected ? "border-[#011c3a]" : "border-neutral-300 hover:border-neutral-500") + " flex h-9 w-9 items-center justify-center rounded-full border bg-white transition"}>
            <span className="h-6 w-6 rounded-full border border-black/10" style={{ backgroundColor: c.hex }} />
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const minimum = 12;
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
        <span className="bg-[#f6f6f4] px-3 py-2 text-[10.5px] num-fa">{fa(lines.length)} ردیف سفارش</span>
      </div>

      <ColourWheel product={product} selected={colourIdx} onSelect={onColourChange} />

      <div className="mt-5 border-y border-neutral-200 py-4">
        <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] text-neutral-500">قیمت عمده فعلی</p><p className="mt-1 text-[17px] font-medium num-fa">{toman(unitPrice)} <span className="text-[10px] font-normal text-neutral-400">/ عدد</span></p></div><p className="text-[10px] text-neutral-500">فروش فقط به‌صورت <strong className="font-medium">کالکشن آماده</strong></p></div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-neutral-200 bg-[#f6f6f4] p-3 text-center"><div><p className="text-[9px] text-neutral-400">۱۲–۲۳ عدد</p><p className="mt-1 text-[10.5px] num-fa">{toman(baseWholesalePrice)}</p></div><div><p className="text-[9px] text-neutral-400">۲۴–۴۷ عدد</p><p className="mt-1 text-[10.5px] num-fa">{toman(Math.round(baseWholesalePrice * 0.94 / 10_000) * 10_000)}</p></div><div><p className="text-[9px] text-neutral-400">۴۸+ عدد</p><p className="mt-1 text-[10.5px] num-fa">{toman(Math.round(baseWholesalePrice * 0.88 / 10_000) * 10_000)}</p></div></div>
      </div>

      <div className="mt-6 border-y border-neutral-200 py-5">
        <p className="mb-3 text-[11.5px] font-medium">انتخاب کالکشن آماده</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {collectionPacks.map((item) => <button key={item.id} type="button" onClick={() => setPackId(item.id)} className={(packId === item.id ? "border-[#011c3a] bg-[#f3f5f7]" : "border-neutral-200") + " border p-3 text-right transition hover:border-[#011c3a]"}><span className="block text-[11.5px] font-medium">{item.name}</span><span className="mt-1 block text-[10px] text-neutral-500 num-fa">{fa(item.qty)} عدد · {item.mix}</span></button>)}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label>
            <span className="mb-1.5 block text-[10px] text-neutral-500">سایز مرجع الگو</span>
            <select value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)} className="h-10 w-full border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#011c3a]">
              {product.sizes.map((size) => <option key={size.label} value={size.label} disabled={!size.inStock}>{size.label} {!size.inStock ? "— ناموجود" : ""}</option>)}
            </select>
          </label>
          <button type="button" onClick={addLine} className="h-10 self-end bg-[#011c3a] px-5 text-[11.5px] font-medium text-white transition-colors hover:bg-[#0a2c55] active:scale-[0.98]">
            افزودن {pack.name}
          </button>
        </div>
        <fieldset className="mt-5 border-t border-neutral-200 pt-4"><legend className="text-[11.5px] font-medium">خدمات اختصاصی این کالکشن</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{["لیبل اختصاصی برند", "دوخت لوگوی اختصاصی", "بسته‌بندی اختصاصی", "تگ قیمت و بارکد فروشگاه"].map(service=><label key={service} className="flex items-center gap-2 border border-neutral-200 p-3 text-[10.5px]"><input type="checkbox" checked={services.includes(service)} onChange={()=>setServices(current=>current.includes(service)?current.filter(x=>x!==service):[...current,service])} />{service}</label>)}</div><label className="mt-3 block text-[10px] text-neutral-500">توضیحات تولید، محل لوگو یا مشخصات فایل<textarea value={customizationNote} onChange={e=>setCustomizationNote(e.target.value)} rows={3} placeholder="مثلاً لوگو روی آستین چپ با نخ سرمه‌ای دوخته شود…" className="mt-1.5 w-full resize-y border border-neutral-300 p-3 text-[11px] outline-none focus:border-[#011c3a]" /></label></fieldset>
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
          <div className="flex items-center justify-between bg-[#f6f6f4] p-4 text-[12px]">
            <span>جمع کل کالکشن</span>
            <strong className="text-[17px] font-medium num-fa">{fa(total)} عدد</strong>
          </div>
        </div>
      )}

      {submitted ? (
        <div className="mt-4 border border-[#011c3a] bg-white p-4 text-center">
          <Icon name="check" className="mx-auto h-5 w-5" strokeWidth={2.3} />
          <p className="mt-2 text-[12.5px] font-medium">پیش‌سفارش برای بررسی ثبت شد</p>
          <p className="mt-1 text-[10.5px] text-neutral-500">کارشناس فروش برای اعلام قیمت و موجودی نهایی با شما تماس می‌گیرد.</p>
        </div>
      ) : (
        <button
          type="button"
          disabled={lines.length === 0}
          onClick={() => setSubmitted(true)}
          className="mt-4 h-12 w-full bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          ثبت نهایی سفارش کالکشن و دریافت قیمت
        </button>
      )}
      <div className="mt-3 flex items-center justify-between text-[10.5px] text-neutral-500">
        <span>قیمت عمده پس از تأیید حساب همکار نمایش داده می‌شود.</span>
        <Link to="/wholesale?section=form" className="shrink-0 underline underline-offset-2">درخواست حساب همکاری</Link>
      </div>
    </div>
  );
}

/* ------------------------------ راهنمای سایز ------------------------------- */

function SizeGuide({ product, mode }: { product: Product; mode: "chart" | "how" }) {
  return (
    <div className="mt-3 rounded-[3px] border border-neutral-200 bg-white p-4">
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
                  <tr key={r.size} className={i % 2 ? "bg-[#f7f6f3]" : ""}>
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
          <button
            onClick={() => window.open("https://www.aparat.com/", "_blank")}
            className="group relative overflow-hidden bg-neutral-900"
          >
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

/* ---------------------------------- نظرات ---------------------------------- */

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
    <section className="product-reviews bg-[#f6f6f4]">
      <div className="mx-auto w-full px-4 py-14 lg:px-8">
        <h2 className="mb-8 text-[20px] font-medium">نظرات مشتریان</h2>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr] lg:gap-6">
          <div className="review-summary liquid-panel">
            <div className="flex items-end gap-3">
              <span className="text-[44px] font-light leading-none num-fa">{fa(product.rating)}</span>
              <div className="pb-1">
                <Stars value={product.rating} size={14} />
                <p className="mt-1 text-[11px] text-neutral-500">
                  بر اساس {fa(product.reviewCount)} نظر
                </p>
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
                    <div
                      className="review-marker absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                      style={{ right: `calc(${b.pos}% - 5px)` }}
                    />
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

  const [colourIdx, setColourIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [openAcc, setOpenAcc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [sticky, setSticky] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sizeAdvisorOpen, setSizeAdvisorOpen] = useState(false);
  const [stickySizeOpen, setStickySizeOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setColourIdx(0);
    setSize(null);
    setOpenAcc(null);
    setSizeAdvisorOpen(false);
    setStickySizeOpen(false);
  }, [id]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = actionsRef.current;
        if (!el) return;
        setSticky(el.getBoundingClientRect().bottom < 90);
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

  if (!product) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-[14px]">محصول یافت نشد.</p>
        <Link to="/shop" className="rounded-[3px] bg-[#011c3a] px-6 py-2.5 text-[12.5px] text-white">
          بازگشت به فروشگاه
        </Link>
      </div>
    );
  }

  const colour = product.colours[colourIdx];
  const wished = isWished(product.id);
  const inCompare = compare.includes(product.id);
  const { builder } = useSiteSettings();
  const look = looks.find((l) => l.id === product.lookId);
  const lookSettings = builder.look;

  const handleAdd = () => {
    if (!size) {
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
    { title: "توضیحات محصول", body: product.description },
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
        {/* دسکتاپ: گالری سمت راست + باکس خرید و مشخصات سمت چپ */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)] lg:items-start lg:gap-8">
          {/* گالری: ستون راست (در RTL اولین ستون) */}
          <div className="lg:sticky lg:top-[90px] lg:self-start">
            <Gallery product={product} onOpen={(i) => setLightbox(i)} />
          </div>

          {/* اطلاعات محصول: ستون چپ */}
          <div>
          <aside>
            <div className="product-info-panel px-4 pb-8 pt-6 lg:px-6 lg:pb-10 lg:pt-10">
              <div className="mx-auto max-w-[440px] lg:mx-0 lg:max-w-[430px]">
                <nav className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                  <Link to="/" className="hover:underline">خانه</Link>
                  <span>›</span>
                  {wholesale ? (
                    <Link to="/wholesale?section=catalog" className="hover:underline">کاتالوگ عمده</Link>
                  ) : (
                    <Link to={`/shop?cat=${product.category}`} className="hover:underline">{product.categoryLabel}</Link>
                  )}
                  <span>›</span>
                  <span className="text-[#011c3a]">{product.name}</span>
                </nav>

                <div className="mt-3 flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-[24px] font-medium leading-tight">{product.name}</h1>
                    <p className="mt-1 text-[11px] tracking-[0.2em] text-neutral-400">
                      {product.latin.toUpperCase()}
                    </p>
                  </div>
                  <span className="shrink-0 pt-1 text-left text-[13px]">
                    {wholesale ? (
                      <><span className="block font-medium">قیمت همکاری</span><span className="mt-0.5 block text-[10px] text-neutral-400">پس از تأیید حساب</span></>
                    ) : toman(product.price)}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-neutral-500">{product.subtitle}</p>
                  <a href="#reviews" className="flex shrink-0 items-center gap-1.5">
                    <Stars value={product.rating} />
                    <span className="text-[11px] text-neutral-500 num-fa">({fa(product.reviewCount)})</span>
                  </a>
                </div>

                {wholesale ? (
                  <WholesaleOrderPanel product={product} colourIdx={colourIdx} onColourChange={setColourIdx} />
                ) : (
                <>
                {/* رنگ */}
                <div className="mt-6">
                  <ColourWheel product={product} selected={colourIdx} onSelect={setColourIdx} />
                </div>

                {/* سایز */}
                <div id="size-picker" className="mt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium">انتخاب سایز</span>
                    <div className="flex items-center gap-3 text-[11.5px]">
                      <button onClick={() => setOpenAcc(openAcc === "size-chart" ? null : "size-chart")} className="underline underline-offset-2">جدول سایز</button>
                      <span className="h-3 w-px bg-neutral-300" />
                      <button onClick={() => setOpenAcc(openAcc === "size-guide" ? null : "size-guide")} className="underline underline-offset-2">راهنمای سایز</button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {product.sizes.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => s.inStock && setSize(s.label)}
                        disabled={!s.inStock}
                        title={s.inStock ? s.label : "ناموجود"}
                        className={
                          "product-size-option relative h-10 overflow-hidden rounded-xl border text-[12px] transition " +
                          (!s.inStock
                            ? "is-unavailable cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-300"
                            : size === s.label
                              ? "is-selected"
                              : "border-neutral-300 hover:border-[#011c3a]")
                        }
                      >
                        {s.label}
                        {!s.inStock && (
                          <svg viewBox="0 0 40 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                            <line x1="2" y1="38" x2="38" y2="2" stroke="#d4d4d4" strokeWidth="1.5" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>

                  {openAcc === "size-chart" && <SizeGuide product={product} mode="chart" />}
                  {openAcc === "size-guide" && <SizeGuide product={product} mode="how" />}
                </div>

                {/* دکمه‌ها */}
                <div ref={actionsRef} className="mt-5">
                  <div className="product-main-actions flex gap-2">
                    <button
                      onClick={handleAdd}
                      className="storefront-primary-action flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[13px] font-medium"
                    >
                      <Icon name="bag" className="h-4 w-4" />
                      {size ? "افزودن به سبد خرید" : "یک سایز انتخاب کنید"}
                    </button>
                    <button
                      onClick={() => toggleWish(product.id)}
                      aria-label="علاقه‌مندی"
                      className="storefront-icon-action flex h-12 w-12 items-center justify-center rounded-full border border-neutral-300 transition"
                    >
                      <Icon name="heart" className="h-4 w-4" fill={wished ? "#011c3a" : "none"} />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => toggleCompare(product.id)}
                      className={
                        "storefront-secondary-action flex h-10 items-center justify-center gap-2 rounded-full border text-[12px] transition " +
                        (inCompare ? "is-active" : "")
                      }
                    >
                      {inCompare ? "در لیست مقایسه" : "افزودن به مقایسه"}
                    </button>
                    <button
                      onClick={share}
                      className="storefront-secondary-action flex h-10 items-center justify-center gap-2 rounded-full border text-[12px] transition"
                    >
                      {copied ? "لینک کپی شد" : "اشتراک‌گذاری"}
                    </button>
                  </div>
                </div>

                <ul className="mt-5 space-y-1.5 text-[11.5px]">
                  {[
                    "ارسال رایگان برای سفارش‌های بالای ۳ میلیون تومان",
                    "۳۰ روز مهلت مرجوعی و تعویض",
                    "دوخت دست در کارگاه کلبه",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button onClick={() => setSizeAdvisorOpen(true)} className="size-advisor-trigger storefront-secondary-action flex min-h-12 items-center justify-center gap-2 rounded-full px-3 text-[11.5px] font-medium">
                    <Icon name="user" className="h-4 w-4" /> پیشنهاد هوشمند سایز
                  </button>
                  <Link to={`/try-on?top=${product.id}`} className="ai-tryon-button flex min-h-12 items-center justify-center gap-2 rounded-full px-3 text-[11.5px] font-medium">
                    <Icon name="star" className="h-4 w-4" /> Try On Me
                  </Link>
                </div>
                </>
                )}
              </div>
            </div>
          </aside>

          {/* مشخصات فنی: ستون چپ، همتراز با باکس خرید */}
          <section className="border-t border-neutral-200 px-4 pt-10 lg:border-t-0 lg:px-0 lg:pt-2">
            <div className="product-specs-table overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {specOrder.map((key, i) => (
                    <tr key={key} className={"product-spec-row grid grid-cols-[42%_58%] gap-x-4 px-4 py-3 " + (i % 2 === 0 ? "" : "is-alt")}>
                      <th className="text-right font-medium text-neutral-500">{specLabels[key]}</th>
                      <td className="text-right">{product.specs[key]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </div>
        </div>

        <div id="reviews">
          <Reviews product={product} />
        </div>

        {/* با این ست کنید — قابل کنترل کامل از سایتساز (هاستاسپاتها، متن، رنگ، نمایش) */}
        {lookSettings.enabled && (
          <section className="border-t border-neutral-200 bg-[#f6f6f4]">
            <div className="mx-auto w-full px-4 py-14 lg:px-8">
              <div className="mb-8">
                <p className="text-[11px] tracking-[0.3em] text-neutral-400">COMPLETE THE LOOK</p>
                <h2 className="mt-2 text-[20px] font-medium">با این ست کنید</h2>
                <p className="mt-2 text-[12.5px] text-neutral-500">{lookSettings.subtitle}</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
                <div className="relative overflow-hidden bg-neutral-100">
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
                      <Link key={lp.id} to={lp.to || "/shop"} className="group block overflow-hidden bg-white">
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

        {/* محصولات مشابه */}
        <section className="mx-auto w-full px-4 py-14 lg:px-8">
          <h2 className="mb-6 text-[18px] font-medium">محصولات مشابه</h2>
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
        </section>

        {/* جزئیات و توضیحات محصول - تمامعرض، زیر دو ستون خرید و مشخصات */}
        <section className="border-t border-neutral-200 bg-[#f6f6f4]">
          <div className="mx-auto w-full px-4 py-14 lg:px-8">
            <div className="max-w-5xl">
              <h2 className="text-[18px] font-medium">جزئیات محصول</h2>
              <p className="mt-4 text-[12.5px] leading-[2] text-neutral-600">{product.description}</p>

              <div className="mt-7 border-t border-neutral-200">
                {accordions.map((a) => (
                  <div key={a.title} className="border-b border-neutral-200">
                    <button
                      onClick={() => setOpenAcc(openAcc === a.title ? null : a.title)}
                      className="flex w-full items-center justify-between py-3.5 text-right text-[13px]"
                    >
                      {a.title}
                      <Icon
                        name={openAcc === a.title ? "minus" : "plus"}
                        className="h-3.5 w-3.5 text-neutral-400"
                      />
                    </button>
                    {openAcc === a.title && (
                      <p className="pb-4 pl-4 text-[12.5px] leading-[2] text-neutral-600">{a.body}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                {[
                  { icon: "needle", title: "دوخت دست", text: "هر قطعه در کارگاه کلبه و با نظارت خیاط ارشد دوخته می‌شود." },
                  { icon: "shield", title: "ضمانت کیفیت", text: "تا یک سال پس از خرید، تعمیرات دوخت رایگان است." },
                ].map((f) => (
                  <div key={f.title} className="flex gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300">
                      <Icon name={f.icon} className="h-4 w-4" strokeWidth={1.3} />
                    </div>
                    <div>
                      <p className="text-[12px] font-medium">{f.title}</p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{f.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* نوار چسبان خرید */}
      {!wholesale && sticky &&
        createPortal(
          <div className="product-sticky-purchase liquid-surface sticky-purchase-in fixed inset-x-0 bottom-0 z-[90] border-t border-neutral-200 bg-white/97 px-3 py-2.5 shadow-[0_-8px_25px_rgba(1,28,58,0.09)] backdrop-blur sm:px-5">
            <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 sm:gap-4">
              <img src={colour.img} alt="" className="hidden h-12 w-9 shrink-0 object-cover sm:block" />
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-[12.5px] font-medium">{product.name}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {colour.name} {size ? `— سایز ${size}` : ""}
                </p>
              </div>
              <span className="mr-auto shrink-0 text-[13px] font-medium num-fa">{toman(product.price)}</span>
              <div className="sticky-size-picker relative shrink-0">
                <button
                  type="button"
                  onClick={() => setStickySizeOpen((open) => !open)}
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
                        onClick={() => { setSize(item.label); setStickySizeOpen(false); }}
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
                <Icon name="bag" className="h-4 w-4 shrink-0" />
                افزودن به سبد
              </button>
            </div>
          </div>,
          document.body,
        )}

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
              <SizeAdvisor product={product} onPick={(pickedSize) => { setSize(pickedSize); setSizeAdvisorOpen(false); }} />
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
