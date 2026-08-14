import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "../router";
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
    <span className="inline-flex items-center gap-[1px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={i <= Math.round(value) ? "fill-[#011c3a]" : "fill-neutral-300"}
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

function ZoomImage({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  return (
    <figure
      className="relative cursor-zoom-in overflow-hidden bg-neutral-100"
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
        className="aspect-[3/4] w-full object-cover transition-transform duration-300"
        style={{ transform: zoom ? "scale(1.7)" : "scale(1)", transformOrigin: `${pos.x}% ${pos.y}%` }}
      />
    </figure>
  );
}

function Gallery({ product, onOpen }: { product: Product; onOpen: (i: number) => void }) {
  const media = product.images;

  return (
    <>
      {/* موبایل: اسکرول افقی */}
      <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto lg:hidden">
        {media.map((src, i) => (
          <div key={i} className="w-full shrink-0 snap-center" onClick={() => onOpen(i)}>
            <img src={src} alt={product.name} loading={i === 0 ? "eager" : "lazy"} className="aspect-[3/4] w-full object-cover" />
          </div>
        ))}
        {product.video && (
          <button
            onClick={() => window.open(product.video!.url, "_blank")}
            className="relative w-full shrink-0 snap-center"
          >
            <img src={product.video.poster} alt={product.video.title} loading="lazy" className="aspect-[3/4] w-full object-cover brightness-75" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70 text-white">
                <Icon name="play" className="mr-1 h-5 w-5" fill="currentColor" strokeWidth={0} />
              </span>
            </span>
          </button>
        )}
      </div>

      {/* دسکتاپ: گرید ۲ ستونه */}
      <div className="hidden grid-cols-2 gap-[3px] lg:grid">
        {media.map((src, i) => (
          <ZoomImage key={i} src={src} alt={`${product.name} — تصویر ${fa(i + 1)}`} onOpen={() => onOpen(i)} />
        ))}
        {product.video && (
          <button
            onClick={() => window.open(product.video!.url, "_blank")}
            className="group relative overflow-hidden bg-neutral-900"
          >
            <img
              src={product.video.poster}
              alt={product.video.title}
              loading="lazy"
              className="aspect-[3/4] w-full object-cover opacity-70 transition group-hover:opacity-60"
            />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70">
                <Icon name="play" className="mr-1 h-5 w-5" fill="currentColor" strokeWidth={0} />
              </span>
              <span className="text-[11.5px]">{product.video.title}</span>
            </span>
          </button>
        )}
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
  const SIZE = 190;
  const C = SIZE / 2;
  const R_OUT = 90;
  const R_IN = 52;
  const n = product.colours.length;
  const step = 360 / n;

  const polar = (r: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };

  const sector = (start: number, end: number) => {
    const [x1, y1] = polar(R_OUT, start);
    const [x2, y2] = polar(R_OUT, end);
    const [x3, y3] = polar(R_IN, end);
    const [x4, y4] = polar(R_IN, start);
    const large = end - start > 180 ? 1 : 0;
    return `M${x1} ${y1} A${R_OUT} ${R_OUT} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${R_IN} ${R_IN} 0 ${large} 0 ${x4} ${y4} Z`;
  };

  const sel = product.colours[selected];

  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-[168px] w-[168px] shrink-0">
        {product.colours.map((c, i) => {
          const start = i * step;
          const active = i === selected;
          return (
            <path
              key={c.name}
              d={sector(start + 1, start + step - 1)}
              fill={c.hex}
              stroke={active ? "#011c3a" : "#e5e5e5"}
              strokeWidth={active ? 2 : 0.6}
              className="cursor-pointer transition-opacity hover:opacity-80"
              onClick={() => onSelect(i)}
            >
              <title>{c.name}</title>
            </path>
          );
        })}
        <circle cx={C} cy={C} r={R_IN - 4} fill={sel.hex} stroke="#e5e5e5" strokeWidth="1" />
      </svg>

      <div className="min-w-0">
        <p className="text-[11px] text-neutral-500">رنگ انتخابی</p>
        <p className="mt-0.5 text-[14px] font-medium">{sel.name}</p>
        <p className="mt-2 text-[11.5px] text-neutral-500">{fa(n)} رنگ موجود</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {product.colours.map((c, i) => (
            <button
              key={c.name}
              onClick={() => onSelect(i)}
              title={c.name}
              aria-label={c.name}
              className={
                "h-6 w-6 rounded-full border-2 transition " +
                (i === selected ? "border-[#011c3a]" : "border-neutral-200 hover:border-neutral-400")
              }
              style={{ background: c.hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ راهنمای سایز ------------------------------- */

function SizeGuide({ product }: { product: Product }) {
  const [tab, setTab] = useState<"chart" | "how">("chart");

  return (
    <div className="mt-3 rounded-[3px] border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex gap-2">
        {[
          { id: "chart" as const, label: "جدول سایز" },
          { id: "how" as const, label: "نحوه اندازه‌گیری" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "rounded-[3px] px-3.5 py-1.5 text-[11.5px] transition " +
              (tab === t.id ? "bg-[#011c3a] text-white" : "border border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chart" ? (
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
    <section className="bg-[#f6f6f4]">
      <div className="mx-auto w-full px-4 py-14 lg:px-8">
        <h2 className="mb-8 text-[20px] font-medium">نظرات مشتریان</h2>

        <div className="grid gap-10 lg:grid-cols-[300px_1fr] lg:gap-16">
          <div>
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
                    <div className="h-full bg-[#011c3a]" style={{ width: `${(d.count / max) * 100}%` }} />
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
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[#011c3a]"
                      style={{ right: `calc(${b.pos}% - 5px)` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y divide-neutral-200">
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
  
  const product = productById(id);
  const { addToCart, toggleWish, isWished, toggleCompare, compare } = useStore();

  const [colourIdx, setColourIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [openAcc, setOpenAcc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [sticky, setSticky] = useState(false);
  const [copied, setCopied] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setColourIdx(0);
    setSize(null);
    setOpenAcc(null);
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
  const look = looks.find((l) => l.id === product.lookId);

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
        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
          <Gallery product={product} onOpen={(i) => setLightbox(i)} />

          <aside className="self-start lg:sticky lg:top-[108px]">
            <div className="px-4 pb-8 pt-6 lg:px-8 lg:pb-10 lg:pt-8">
              <div className="mx-auto max-w-[440px] lg:mx-0">
                <nav className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                  <Link to="/" className="hover:underline">خانه</Link>
                  <span>›</span>
                  <Link to={`/shop?cat=${product.category}`} className="hover:underline">
                    {product.categoryLabel}
                  </Link>
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
                  <span className="shrink-0 pt-1 text-[16px] num-fa">{toman(product.price)}</span>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-neutral-500">{product.subtitle}</p>
                  <a href="#reviews" className="flex shrink-0 items-center gap-1.5">
                    <Stars value={product.rating} />
                    <span className="text-[11px] text-neutral-500 num-fa">({fa(product.reviewCount)})</span>
                  </a>
                </div>

                {/* رنگ */}
                <div className="mt-6">
                  <ColourWheel product={product} selected={colourIdx} onSelect={setColourIdx} />
                </div>

                {/* سایز */}
                <div id="size-picker" className="mt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium">انتخاب سایز</span>
                    <button
                      onClick={() => setOpenAcc(openAcc === "guide" ? null : "guide")}
                      className="text-[11.5px] underline underline-offset-2"
                    >
                      راهنمای سایز
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {product.sizes.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => s.inStock && setSize(s.label)}
                        disabled={!s.inStock}
                        title={s.inStock ? s.label : "ناموجود"}
                        className={
                          "relative h-10 overflow-hidden rounded-[3px] border text-[12px] transition " +
                          (!s.inStock
                            ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-300"
                            : size === s.label
                              ? "border-[#011c3a] bg-[#011c3a] text-white"
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

                  {openAcc === "guide" && <SizeGuide product={product} />}
                </div>

                {/* دکمه‌ها */}
                <div ref={actionsRef} className="mt-5">
                  <div className="flex gap-2">
                    <button
                      onClick={handleAdd}
                      className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55]"
                    >
                      <Icon name="bag" className="h-4 w-4" />
                      {size ? "افزودن به سبد خرید" : "یک سایز انتخاب کنید"}
                    </button>
                    <button
                      onClick={() => toggleWish(product.id)}
                      aria-label="علاقه‌مندی"
                      className="flex h-12 w-12 items-center justify-center rounded-[3px] border border-neutral-300 transition hover:border-[#011c3a]"
                    >
                      <Icon name="heart" className="h-4 w-4" fill={wished ? "#011c3a" : "none"} />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => toggleCompare(product.id)}
                      className={
                        "flex h-10 items-center justify-center gap-2 rounded-[3px] border text-[12px] transition " +
                        (inCompare ? "border-[#011c3a] bg-[#f7f6f3]" : "border-neutral-300 hover:border-[#011c3a]")
                      }
                    >
                      {inCompare ? "در لیست مقایسه" : "افزودن به مقایسه"}
                    </button>
                    <button
                      onClick={share}
                      className="flex h-10 items-center justify-center gap-2 rounded-[3px] border border-neutral-300 text-[12px] transition hover:border-[#011c3a]"
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

                {/* پیشنهاد هوشمند سایز */}
                <div className="mt-6">
                  <SizeAdvisor product={product} onPick={setSize} />
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* جزئیات + جدول مشخصات */}
        <section className="border-t border-neutral-200">
          <div className="mx-auto grid w-full gap-10 px-4 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-8">
            <div>
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

              <div className="mt-7 space-y-4">
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

            <div>
              <h3 className="mb-5 text-[18px] font-medium">مشخصات فنی</h3>
              <div className="overflow-hidden rounded-[3px] border border-neutral-200">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {specOrder.map((key, i) => (
                      <tr
                        key={key}
                        className={
                          "grid grid-cols-[40%_60%] gap-x-4 px-4 py-2.5 " +
                          (i % 2 === 0 ? "bg-white" : "bg-[#f7f6f3]")
                        }
                      >
                        <th className="text-right font-medium text-neutral-500">{specLabels[key]}</th>
                        <td className="text-right">{product.specs[key]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => toggleCompare(product.id)}
                className="mt-3 text-[11.5px] text-neutral-500 underline hover:text-[#011c3a]"
              >
                افزودن این محصول به مقایسه
              </button>
            </div>
          </div>
        </section>

        {/* با این ست کنید */}
        {look && (
          <section className="border-t border-neutral-200 bg-[#f6f6f4]">
            <div className="mx-auto w-full px-4 py-14 lg:px-8">
              <div className="mb-8">
                <p className="text-[11px] tracking-[0.3em] text-neutral-400">COMPLETE THE LOOK</p>
                <h2 className="mt-2 text-[20px] font-medium">با این ست کنید</h2>
                <p className="mt-2 text-[12.5px] text-neutral-500">
                  پیشنهاد استایلیست‌های کلبه برای تکمیل این ست — شلوار، کفش و قطعات مکمل.
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
                <div className="overflow-hidden bg-neutral-100">
                  <img src={look.img} alt={look.title} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                </div>

                <div>
                  <h3 className="text-[16px] font-medium">{look.title}</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {complementary.map((p) => (
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

        <div id="reviews">
          <Reviews product={product} />
        </div>
      </main>

      {/* نوار چسبان خرید */}
      {sticky &&
        createPortal(
          <div className="sticky-purchase-in fixed inset-x-0 bottom-0 z-[90] border-t border-neutral-200 bg-white/97 px-3 py-2.5 shadow-[0_-8px_25px_rgba(1,28,58,0.09)] backdrop-blur sm:px-5">
            <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 sm:gap-4">
              <img src={colour.img} alt="" className="hidden h-12 w-9 shrink-0 object-cover sm:block" />
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-[12.5px] font-medium">{product.name}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {colour.name} {size ? `— سایز ${size}` : ""}
                </p>
              </div>
              <span className="mr-auto shrink-0 text-[13px] font-medium num-fa">{toman(product.price)}</span>
              <select
                value={size ?? ""}
                onChange={(e) => setSize(e.target.value || null)}
                className="h-10 shrink-0 rounded-[3px] border border-neutral-300 bg-white px-2 text-[12px] outline-none"
              >
                <option value="">سایز</option>
                {product.sizes.filter((s) => s.inStock).map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[3px] bg-[#011c3a] px-4 text-[12px] font-medium text-white transition hover:bg-[#0a2c55] sm:w-[220px] sm:flex-none sm:text-[13px]"
              >
                <Icon name="bag" className="h-4 w-4 shrink-0" />
                افزودن به سبد
              </button>
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
