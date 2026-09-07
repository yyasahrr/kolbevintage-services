import { HeroStudioRenderer } from "../components/heroTemplates";
import { useEffect, useState } from "react";
import { Link } from "../router";
import { products } from "../data/catalog";
import { styles, looks, trustBadges } from "../siteData";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import ProductCard from "../components/ProductCard";
import Icon from "../components/Icon";
import { loadHomepageArticles, subscribeToJournalSettings } from "../journalSettings";
import HomepageHero from "../components/HomepageHero";
import FestivalCountdownOverlay from "../components/FestivalCountdown";
import { useSiteSettings } from "../siteSettings";

/* ---------------------------------- ۱. هیرو ---------------------------------- */

/* ------------------------------ ۲. جدیدترین کالکشن ---------------------------- */

function NewArrivals() {
  const items = [...products].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  return (
    <section className="mx-auto w-full max-w-[1240px] px-4 py-12 lg:px-8 lg:py-20">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.3em] text-neutral-400">NEW ARRIVALS</p>
          <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">جدیدترین کالکشن</h2>
        </div>
        <Link to="/shop?sort=new" className="shrink-0 text-[12.5px] underline underline-offset-4 hover:no-underline">
          مشاهده همه
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-5 lg:gap-x-5">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ ۳. بنر کالکشن ------------------------------- */

function CollectionBanner() {
  const { collectionBanner: legacy, builder } = useSiteSettings();
  const banner = builder.banner;
  const bannerMedia = banner.media && banner.media !== "(تصویر آپلودشده)" ? banner.media : banner.poster || "/images/banner.jpg";
  const countdown = <FestivalCountdownOverlay config={builder.components.countdown} where="featureBanner" />;
  const mediaEl =
    banner.mediaType === "video" ? (
      <video src={bannerMedia} poster={banner.poster || undefined} autoPlay muted loop playsInline className="h-full w-full object-cover" />
    ) : (
      <img src={bannerMedia} alt={banner.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
    );
  void legacy;

  const overlay = <div className="absolute inset-0" style={{ background: `rgba(7,20,34,${banner.overlay})` }} />;
  const copy = (
    <div className={`text-white ${banner.contentAlign === "center" ? "text-center" : banner.contentAlign === "left" ? "text-left" : "text-right"}`} style={{fontFamily:banner.fontFamily}}>
      <p className="text-[11px] tracking-[0.4em] text-white/80">{banner.eyebrow}</p>
      <h2 className="mt-4 font-medium leading-snug" style={{fontSize:`clamp(26px,4vw,${banner.titleSize}px)`}}>{banner.title}</h2>
      {banner.description ? <p className="mx-auto mt-4 max-w-lg text-[13px] leading-relaxed text-white/85">{banner.description}</p> : null}
      {banner.buttonLabel ? (
        <Link
          to={banner.buttonTo}
          className="banner-cta mt-7 inline-block rounded-[3px] px-8 py-3 text-[13px] font-medium transition active:translate-y-px"
          style={{
            background: banner.buttonBg,
            color: banner.buttonText,
            ["--banner-hover-bg" as string]: banner.buttonHoverBg,
            ["--banner-hover-text" as string]: banner.buttonHoverText,
          }}
        >
          {banner.buttonLabel}
        </Link>
      ) : null}
    </div>
  );

  if (banner.mode === "split") {
    return (
      <section className="grid overflow-hidden lg:grid-cols-2">
        <div className="relative min-h-[320px] lg:min-h-[520px]">{mediaEl}{overlay}{countdown}</div>
        <div className="flex items-center justify-center bg-[#f7f5f0] px-8 py-16">{copy}</div>
      </section>
    );
  }

  if (banner.mode === "grid3") {
    return (
      <section className="mx-auto w-full max-w-[1240px] px-4 py-12 lg:px-8">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="relative min-h-[320px] overflow-hidden lg:col-span-2 lg:min-h-[460px]">{mediaEl}{overlay}{countdown}
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">{copy}</div>
          </div>
          <div className="grid gap-3">
            <div className="relative min-h-[150px] overflow-hidden lg:min-h-[223px]"><img src={banner.tile2} alt="" loading="lazy" className="h-full w-full object-cover" /><div className="absolute inset-0" style={{ background: `rgba(7,20,34,${Math.min(banner.overlay, 0.3)})` }} /></div>
            <div className="relative min-h-[150px] overflow-hidden lg:min-h-[223px]"><img src={banner.tile3} alt="" loading="lazy" className="h-full w-full object-cover" /><div className="absolute inset-0" style={{ background: `rgba(7,20,34,${Math.min(banner.overlay, 0.3)})` }} /></div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`storefront-feature-banner relative w-full overflow-hidden ${banner.height === "sm" ? "h-[38svh] min-h-[280px]" : banner.height === "lg" ? "h-[72svh] min-h-[520px]" : "h-[52svh] min-h-[360px] max-h-[620px]"} ${banner.radius === "round" ? "mx-auto max-w-[1240px] rounded-[24px]" : banner.radius === "soft" ? "mx-auto max-w-[1240px] rounded-[8px]" : ""}`}>
      {mediaEl}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" style={{ background: `linear-gradient(to top, rgba(7,20,34,${Math.min(banner.overlay + 0.25, 0.85)}), rgba(7,20,34,${banner.overlay * 0.3}))` }} />
      <div className={`absolute inset-0 flex items-center px-6 ${banner.contentAlign === "center" ? "justify-center" : banner.contentAlign === "left" ? "justify-end" : "justify-start"}`}>{copy}</div>
      {countdown}
    </section>
  );
}

/* ---------------------------- ۴. خرید بر اساس استایل --------------------------- */

function ShopByStyle() {
  const { builder } = useSiteSettings();
  const cards = builder.stylesSection.cards.length > 0
    ? builder.stylesSection.cards.map((c) => ({ slug: `custom-${c.id}`, name: c.name, latin: c.latin, img: c.img, count: Number(c.count ?? 0), tagline: c.tagline }))
    : styles;
  const sectionCls = builder.stylesSection.fullBleed
    ? "w-full px-4 py-12 lg:px-10 lg:py-20"
    : "mx-auto w-full max-w-[1240px] px-4 py-12 lg:px-8 lg:py-20";
  return (
    <section className={sectionCls}>
      <div className="mb-8 text-center">
        <p className="text-[11px] tracking-[0.3em] text-neutral-400">SHOP BY STYLE</p>
        <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">خرید بر اساس استایل</h2>
        <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-neutral-500">
          پنج زبان پوشش که کمد کلبه وینتیج بر پایه آن‌ها ساخته شده است.
        </p>
      </div>

      {/* گرید نامتقارن */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3" style={{ gridTemplateColumns: cards.length > 4 ? "repeat(auto-fit, minmax(180px, 1fr))" : undefined, ...(cards.length > 4 ? {} : {}) }} data-count={cards.length}>
        {cards.map((s) => (
          <Link
            key={s.slug}
            to={`/styles?s=${s.slug}`}
            className="style-tile group relative overflow-hidden bg-neutral-100"
          >
            <img
              src={s.img}
              alt={s.name}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-4">
              <h3 className="text-[14px] font-medium sm:text-[16px]">{s.name}</h3>
              <div className="mt-1 flex items-center justify-between gap-2 text-[9.5px] text-white/75 sm:text-[10px]">
                <span className="truncate tracking-[0.18em]">{s.latin.toUpperCase()}</span>
                <span className="shrink-0">{fa(s.count)} محصول</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- ۵. پرفروش‌ترین‌ها ------------------------------ */

function BestSellers() {
  const items = [...products].sort((a, b) => b.sold - a.sold).slice(0, 5);

  return (
    <section className="best-sellers-section mx-auto w-full max-w-[1240px] px-4 py-12 lg:px-8 lg:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-neutral-400">BESTSELLERS</p>
            <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">پرفروش‌ترین محصولات</h2>
          </div>
          <Link to="/shop?sort=best" className="shrink-0 text-[12.5px] underline underline-offset-4 hover:no-underline">
            مشاهده همه
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-5 lg:gap-x-5">
          {items.map((p) => (
            <div key={p.id}>
              <ProductCard product={p} />
            </div>
          ))}
        </div>
    </section>
  );
}

/* --------------------------------- ۶. ویدئو --------------------------------- */

function BrandVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="storefront-feature-banner relative h-[55svh] min-h-[360px] max-h-[620px] w-full overflow-hidden bg-black">
      {playing ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-center text-white">
          <Icon name="play" className="h-10 w-10 opacity-40" fill="currentColor" strokeWidth={0} />
          <p className="text-[13px] text-white/70">
            ویدئوی معرفی کالکشن پاییز
          </p>
          <a
            href="https://www.aparat.com/"
            target="_blank"
            rel="noreferrer"
            className="rounded-[3px] bg-white px-6 py-2.5 text-[12.5px] font-medium text-[#011c3a]"
          >
            تماشا در آپارات
          </a>
          <button onClick={() => setPlaying(false)} className="text-[11.5px] text-white/50 underline">
            بازگشت
          </button>
        </div>
      ) : (
        <>
          <img
            src="/images/model-full.jpg"
            alt="ویدئوی معرفی کالکشن"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-black/25" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center text-white">
            <button
              onClick={() => setPlaying(true)}
              aria-label="پخش ویدئو"
              className="flex h-16 w-16 items-center justify-center rounded-full border border-white/60 backdrop-blur transition hover:bg-white hover:text-[#011c3a]"
            >
              <Icon name="play" className="mr-1 h-6 w-6" fill="currentColor" strokeWidth={0} />
            </button>
            <div>
              <p className="text-[11px] tracking-[0.4em] text-white/75">THE FILM</p>
              <h2 className="mt-3 text-[22px] font-medium lg:text-[28px]">کالکشن پاییز، پشت دوربین</h2>
              <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-white/80">
                یک دقیقه و نیم از کارگاه دوخت تا خیابان — ببینید هر قطعه چطور ساخته می‌شود.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------- ۷. استایل‌های پیشنهادی (ست) ------------------------- */

function ShopTheLook() {
  const [active, setActive] = useState(0);
  const { addToCart } = useStore();
  const { builder } = useSiteSettings();
  const look = looks[active];
  const total = look.items.reduce((s, i) => s + i.price, 0);
  const compact = builder.look.compact;

  const addAll = () => {
    look.items.forEach((i) => {
      const p = products.find((x) => x.id === i.productId);
      addToCart({
        id: i.productId,
        name: i.name,
        colour: p?.colours[0].name ?? "—",
        size: "M",
        price: i.price,
        img: p?.images[0] ?? look.img,
      });
    });
  };

  return (
    <section className={`shop-look-section liquid-panel mx-auto w-[calc(100%_-_1rem)] max-w-[1200px] px-4 sm:w-[calc(100%_-_2rem)] lg:px-8 ${compact ? "my-7 py-6 lg:my-10 lg:py-8" : "my-12 py-10 lg:my-20 lg:py-12"}`}>
      <div className={compact ? "mb-5 text-center" : "mb-8 text-center"}>
        <p className="text-[11px] tracking-[0.3em] text-neutral-400">SHOP THE LOOK</p>
        <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">استایل‌های پیشنهادی</h2>
        <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-neutral-500">
          ست‌های آماده‌ای که استایلیست‌های ما چیده‌اند. روی نقطه‌ها بزنید و قطعات را ببینید.
        </p>
      </div>

      <div className="mb-6 flex justify-center gap-2">
        {looks.map((l, i) => (
          <button
            key={l.id}
            onClick={() => setActive(i)}
            className={
              "rounded-full border px-4 py-2 text-[11.5px] transition " +
              (i === active ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {l.season}
          </button>
        ))}
      </div>

      <div className={`shop-look-layout grid gap-6 lg:grid-cols-[0.72fr_1.28fr] ${compact ? "lg:gap-7" : "lg:gap-10"}`}>
        {/* عکس با نقطه‌های تعاملی */}
        <div className={`shop-look-visual relative mx-auto overflow-hidden rounded-[1rem] border border-neutral-200 bg-neutral-100 p-1.5 ${compact ? "w-[68%] sm:w-[44%] lg:w-full" : "w-[82%] sm:w-[56%] lg:w-full"}`}>
          <img
            src={look.img}
            alt={look.title}
            loading="lazy"
            decoding="async"
            className="aspect-[4/5] w-full object-cover"
          />
          <span className="absolute right-4 top-4 rounded-full border border-white/35 bg-[#011c3a]/85 px-3 py-1.5 text-[9.5px] text-white backdrop-blur-sm">
            روی نشانگرها بزنید
          </span>
          {look.items.map((item, i) => {
            const pos = [
              { top: "26%", right: "38%" },
              { top: "58%", right: "45%" },
              { top: "16%", right: "60%" },
            ][i];
            return (
              <Link
                key={item.productId}
                to={`/product/${item.productId}`}
                aria-label={`مشاهده ${item.name}`}
                className="group absolute z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#011c3a] text-[10px] font-medium text-white shadow-[0_2px_12px_rgba(1,28,58,0.3)] transition hover:scale-110 focus-visible:scale-110"
                style={pos}
              >
                <span className="absolute inset-[-7px] -z-10 rounded-full border border-white/80 bg-white/20 animate-ping" aria-hidden="true" />
                <span>{fa(i + 1)}</span>
                <span className="pointer-events-none absolute top-10 whitespace-nowrap border border-white/15 bg-[#011c3a] px-2.5 py-1.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                  {item.name}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="shop-look-details self-center rounded-[1.35rem] border border-neutral-200 p-4 sm:p-6">
          <p className="text-[11px] tracking-[0.25em] text-neutral-400">{look.season.toUpperCase()}</p>
          <h3 className="mt-2 text-[20px] font-medium lg:text-[24px]">{look.title}</h3>

          <div className="shop-look-list mt-6 divide-y divide-neutral-200 border-y border-neutral-200">
            {look.items.map((item) => {
              const p = products.find((x) => x.id === item.productId);
              return (
                <div key={item.productId} className="flex items-center gap-3 py-3">
                  <Link to={`/product/${item.productId}`}>
                    <img src={p?.images[0] || look.img || "/images/flat.jpg"} alt={item.name} className="h-16 w-12 object-cover" loading="lazy" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/product/${item.productId}`} className="block truncate text-[12.5px] hover:underline">
                      {item.name}
                    </Link>
                    <p className="mt-0.5 text-[11.5px] text-neutral-500 num-fa">{toman(item.price)}</p>
                  </div>
                  <button
                    onClick={() =>
                      addToCart({
                        id: item.productId,
                        name: item.name,
                        colour: p?.colours[0].name ?? "—",
                        size: "M",
                        price: item.price,
                        img: p?.images[0] ?? look.img,
                      })
                    }
                    className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-[11px] transition hover:border-[#011c3a]"
                  >
                    افزودن
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <span className="text-[12.5px] text-neutral-600">قیمت کل ست</span>
            <span className="text-[15px] font-medium num-fa">{toman(total)}</span>
          </div>

          <button
            onClick={addAll}
            className="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55]"
          >
            خرید کل ست
          </button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- ۸. مقالات -------------------------------- */

function Journal() {
  const { builder } = useSiteSettings();
  const [items, setItems] = useState(loadHomepageArticles);

  useEffect(() => subscribeToJournalSettings(() => setItems(loadHomepageArticles())), []);

  type JournalItem = { slug: string; title: string; img: string; category: string; readTime: number; excerpt?: string; pinned?: boolean };
  const settingsPosts: JournalItem[] = builder.blog.posts.map((post) => ({
    slug: post.slug, title: post.title, img: post.cover, category: post.category,
    readTime: Number(post.readTime) || 3, excerpt: post.excerpt, pinned: post.pinned,
  }));
  const fallbackItems: JournalItem[] = items.map((a) => ({
    slug: a.slug, title: a.title, img: a.img, category: a.category, readTime: a.readTime,
  }));
  const merged = settingsPosts.length > 0
    ? [...settingsPosts].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)).slice(0, builder.blog.homeCount)
    : fallbackItems.slice(0, builder.blog.homeCount);
  const gridCls = builder.blog.homeGrid === "2col" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : builder.blog.homeGrid === "list" ? "flex flex-col gap-4" : "journal-grid grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12 lg:auto-rows-[13rem]";

  if (!merged.length) return null;

  return (
    <section className="journal-section bg-[#f6f6f4] py-16 lg:py-24">
      <div className="mx-auto w-full max-w-[1200px] px-4 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-neutral-400">JOURNAL</p>
            <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">مجله استایل</h2>
          </div>
          <Link to="/blog" className="shrink-0 text-[12.5px] underline underline-offset-4 hover:no-underline">
            همه مقالات
          </Link>
        </div>

        <div className={gridCls}>
          {merged.map((a, index) => {
            const pattern = index % 4;
            const listMode = builder.blog.homeGrid === "list";
            const twoCol = builder.blog.homeGrid === "2col";
            if (listMode || twoCol) {
              return (
                <Link key={a.slug} to={`/blog/${a.slug}`} className="editorial-tile group grid gap-4 overflow-hidden rounded-[1.35rem] bg-white sm:grid-cols-[240px_1fr]">
                  <img src={a.img} alt={a.title} loading="lazy" className="h-44 w-full object-cover sm:h-full" />
                  <div className="p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      {a.pinned ? <span className="rounded-full bg-[#011c3a] px-2 py-0.5 text-[8.5px] text-white">سنجاق‌شده</span> : null}
                      <span className="text-[9.5px] tracking-[0.2em] text-neutral-400">{a.category}</span>
                    </div>
                    <h3 className="mt-2 text-[14px] font-medium leading-relaxed">{a.title}</h3>
                    <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-neutral-500">{a.excerpt ?? ""}</p>
                    <p className="mt-3 text-[10.5px] text-neutral-400">{fa(a.readTime)} دقیقه مطالعه</p>
                  </div>
                </Link>
              );
            }
            return (
            <Link
              key={a.slug}
              to={`/blog/${a.slug}`}
              className={
                "editorial-tile group relative overflow-hidden rounded-[1.35rem] bg-neutral-200 " +
                (pattern === 0
                  ? "col-span-2 aspect-[16/10] lg:col-span-6 lg:row-span-2 lg:aspect-auto"
                  : pattern === 1
                    ? "aspect-[4/5] lg:col-span-6 lg:aspect-auto"
                    : pattern === 2
                      ? "aspect-[4/5] lg:col-span-3 lg:aspect-auto"
                      : "col-span-2 aspect-[16/9] lg:col-span-3 lg:aspect-auto")
              }
            >
              <img
                src={a.img}
                alt={a.title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025] group-hover:opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-4">
                <span className="text-[9.5px] tracking-[0.2em] text-white/70">{a.category}</span>
                <h3 className="mt-1.5 text-[12px] font-medium leading-relaxed sm:mt-2 sm:text-[14px]">{a.title}</h3>
                <p className="mt-2 text-[10.5px] text-white/65">{fa(a.readTime)} دقیقه مطالعه</p>
              </div>
            </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ ۹. اینستاگرام ------------------------------- */

function InstagramGrid() {
  const { builder } = useSiteSettings();
  const insta = builder.instagram;
  const shots = [
    "/images/model-front.jpg",
    "/images/detail-collar.jpg",
    "/images/model-teal.jpg",
    "/images/flat.jpg",
    "/images/model-full.jpg",
    "/images/detail-hem.jpg",
  ];
  if (!insta.enabled) return null;

  return (
    <section className="mx-auto w-full px-4 py-16 lg:px-8 lg:py-20">
      <div className="mb-6 text-center">
        <h2 className="text-[18px] font-medium lg:text-[20px]">@{insta.username || "kolbevintage"}</h2>
        <p className="mt-2 text-[12px] text-neutral-500">ما را در اینستاگرام دنبال کنید</p>
      </div>
      {insta.cards.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:mb-8">
          {insta.cards.map((card) => (
            <div key={card.id} className="group flex items-center gap-3 border border-neutral-200 bg-white p-4 transition hover:border-[#011c3a]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f6f6f4]"><Icon name={card.icon} className="h-5 w-5" strokeWidth={1.4} /></span>
              <div>
                <p className="text-[12.5px] font-medium">{card.title}</p>
                <p className="mt-0.5 text-[10.5px] text-neutral-500">{card.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {insta.cta.enabled && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[3px] p-6 text-white lg:mb-8" style={{ background: insta.cta.bg }}>
          <div>
            <p className="text-[14px] font-medium">{insta.cta.title}</p>
            <p className="mt-1 text-[11.5px] text-white/75">{insta.cta.text}</p>
          </div>
          <a href={insta.cta.buttonTo} target="_blank" rel="noreferrer" className="rounded-[3px] bg-white px-6 py-2.5 text-[12px] font-medium text-[#011c3a] transition hover:bg-neutral-100">{insta.cta.buttonLabel}</a>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {shots.map((s, i) => (
          <a
            key={i}
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            className="group relative overflow-hidden bg-neutral-100"
          >
            <img
              src={s}
              alt=""
              loading="lazy"
              decoding="async"
              className="aspect-square w-full object-cover transition-opacity duration-300 group-hover:opacity-80"
            />
          </a>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ ۱۰. نوار مزایا ------------------------------- */

function TrustRow() {
  return (
    <section className="border-y border-neutral-200 bg-white">
      <div className="mx-auto grid w-full grid-cols-2 gap-6 px-4 py-10 lg:grid-cols-4 lg:px-8">
        {trustBadges.map((b) => (
          <div key={b.title} className="flex flex-col items-center gap-2.5 text-center">
            <Icon name={b.icon} className="h-6 w-6 text-[#011c3a]" strokeWidth={1.2} />
            <div>
              <p className="text-[12.5px] font-medium">{b.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{b.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------- صفحه ----------------------------------- */

export default function Home() {
  const { heroStudio, builder } = useSiteSettings();
  const homepage = builder.homepage;
  const modeSections = homepage.mode === "festival"
    ? ["hero", "new-arrivals", "best-sellers", "banner", "trust"]
    : homepage.mode === "landing"
      ? ["hero", "banner", "style-look", "trust"]
      : homepage.mode === "collection"
        ? ["hero", "new-arrivals", "banner", "best-sellers", "trust"]
        : homepage.sections.filter((section) => section.enabled).map((section) => section.type);
  const renderSection = (type: string, index: number) => {
    if (type === "hero") return <div key={`${type}-${index}`} className="relative">{heroStudio.published ? <HeroStudioRenderer config={{ ...heroStudio, countdown: { ...heroStudio.countdown, enabled: false } }} /> : <HomepageHero />}<FestivalCountdownOverlay config={builder.components.countdown} where="hero" /></div>;
    if (type === "categories") return <CategoryBento key={`${type}-${index}`} />;
    if (type === "new-arrivals") return <NewArrivals key={`${type}-${index}`} />;
    if (type === "banner") return <CollectionBanner key={`${type}-${index}`} />;
    if (type === "best-sellers") return <BestSellers key={`${type}-${index}`} />;
    if (type === "style-look") return builder.look.enabled ? <ShopTheLook key={`${type}-${index}`} /> : null;
    if (type === "trust") return <FeatureStrip key={`${type}-${index}`} />;
    return null;
  };
  return (
    <>
      {modeSections.map(renderSection)}
    </>
  );
}


/* ------------------------- نوار ویژگیها (قبل فوتر) ------------------------- */

function FeatureStrip() {
  const features = [
    { icon: "truck", title: "ارسال سریع", text: "به سراسر کشور" },
    { icon: "return", title: "۳۰ روز مرجوعی", text: "بدون قید و شرط" },
    { icon: "shield", title: "پرداخت امن", text: "درگاه معتبر بانکی" },
    { icon: "needle", title: "دوخت دست", text: "کیفیت کارگاهی" },
  ];
  return (
    <section className="border-y border-neutral-200/60 bg-white py-8">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-4 px-4 py-6 sm:grid-cols-4 sm:gap-6 lg:px-8 lg:py-8">
        {features.map(f => (
          <div key={f.title} className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-[#f7f5f0]">
              <Icon name={f.icon} className="h-5 w-5 text-[#011c3a]" strokeWidth={1.3} />
            </div>
            <p className="mt-3 text-[12.5px] font-medium">{f.title}</p>
            <p className="mt-1 text-[10.5px] text-neutral-500">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}


/* --------------------- دسته‌بندی‌های قابل طراحی (بعد از هیرو) --------------------- */

function CategoryBento() {
  const { categories } = useSiteSettings();
  const items = categories.items.filter((item) => item.enabled);
  if (items.length === 0) return null;

  const containerClass = {
    bento: "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:auto-rows-[125px] sm:gap-2.5 lg:grid-cols-4 lg:auto-rows-[145px] lg:gap-3",
    editorial: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:auto-rows-[175px]",
    grid: "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4",
    rail: "rtl-rail flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible",
    split: "grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:gap-4",
  }[categories.layout];
  const radiusClass = categories.radius === "none" ? "rounded-none" : categories.radius === "soft" ? "rounded-md" : "rounded-[1rem]";
  const ratioClass = categories.ratio === "portrait" ? "aspect-[3/4]" : categories.ratio === "square" ? "aspect-square" : "aspect-[4/3]";
  const responsiveRatioClass = categories.layout === "bento" || categories.layout === "editorial" ? `${ratioClass} sm:aspect-auto` : ratioClass;

  const layoutClass = (index: number, featured: boolean) => {
    if (categories.layout === "bento") {
      if (index === 0 || featured) return "sm:row-span-2";
      if (index === 1) return "sm:col-span-2 sm:row-span-2";
      if (index > 3) return "sm:col-span-2";
    }
    if (categories.layout === "editorial") return index === 0 ? "lg:col-span-7 lg:row-span-2" : index === 1 ? "lg:col-span-5 lg:row-span-2" : "lg:col-span-4";
    if (categories.layout === "rail") return "min-w-[78%] snap-start sm:min-w-[44%] lg:min-w-0";
    if (categories.layout === "split") return index < 2 ? "col-span-2 sm:row-span-2" : "col-span-1";
    return "";
  };

  return (
    <section className="category-section mx-auto w-full max-w-[1240px] px-3 py-6 sm:px-4 sm:py-8 lg:px-8 lg:py-9">
      <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
        <div>
          <p className="text-[9px] tracking-[0.25em] text-neutral-400 sm:text-[10px]">{categories.eyebrow}</p>
          <h2 className="mt-1.5 text-[19px] font-medium sm:mt-2 sm:text-[22px] lg:text-[26px]">{categories.title}</h2>
          {categories.description ? <p className="mt-1 max-w-xl text-[11px] text-neutral-500 sm:text-[12px]">{categories.description}</p> : null}
        </div>
        <Link to="/shop" className="shrink-0 text-[11px] text-neutral-500 underline underline-offset-4 transition hover:text-[var(--site-primary)] sm:text-[12px]">
          همه محصولات
        </Link>
      </div>

      <div className={containerClass}>
        {items.map((item, index) => (
          <Link
            key={item.id}
            to={item.to}
            className={`category-card group relative overflow-hidden bg-neutral-100 focus-visible:ring-2 focus-visible:ring-[var(--site-focus)] ${radiusClass} ${responsiveRatioClass} ${layoutClass(index, item.featured)}`}
          >
            <img src={item.image} alt={item.label} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/5" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 text-white sm:p-4">
              <div className="min-w-0">
                <p className="truncate text-[8px] tracking-[0.18em] text-white/65 sm:text-[9px]">{item.latin}</p>
                <h3 className={`mt-1 font-medium leading-snug ${item.featured ? "text-[15px] sm:text-[18px]" : "text-[12px] sm:text-[14px]"}`}>{item.label}</h3>
              </div>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/30 bg-black/10 transition group-hover:border-white group-hover:bg-white group-hover:text-[var(--site-primary)] sm:h-8 sm:w-8">
                <Icon name="arrowLeft" className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              </span>
            </div>
            {categories.showBadges && item.badge ? (
              <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[8.5px] font-medium text-white backdrop-blur-sm">{item.badge}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ----------------------- بنر وسط (بین جدیدترین و پرفروش) ----------------------- */

function MidBanner() {
  const { builder } = useSiteSettings();
  return (
    <section className="mx-auto w-full max-w-[1240px] px-4 py-8 lg:px-8">
      <Link to="/collection" className="group relative block overflow-hidden rounded-[1.2rem]">
        <img src="/images/banner.jpg" alt="کالکشن پاییز" loading="lazy" className="h-[200px] w-full object-cover transition-transform duration-700 group-hover:scale-[1.02] sm:h-[340px]" />
        <div className="absolute inset-0 bg-gradient-to-l from-black/65 via-black/25 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-start justify-center px-5 text-white sm:px-8 lg:px-14">
          <p className="text-[8.5px] tracking-[0.3em] text-white/70 sm:text-[10px] sm:tracking-[0.35em]">AUTUMN COLLECTION</p>
          <h2 className="mt-2 text-[18px] font-medium leading-snug sm:text-[32px]">پاییز، فصل پارچه‌های سنگین</h2>
          <p className="mt-1.5 max-w-md text-[10.5px] leading-relaxed text-white/80 sm:text-[12px]">پشم شورون، بافت کابلی و کشمیر برای سردترین روزهای سال.</p>
          <span className="mt-4 rounded-full bg-white px-5 py-2 text-[11px] font-medium text-[#011c3a] transition group-hover:bg-neutral-100 sm:mt-5 sm:px-6 sm:py-2.5 sm:text-[12px]">مشاهده کالکشن</span>
        </div>
        <FestivalCountdownOverlay config={builder.components.countdown} where="midBanner" />
      </Link>
    </section>
  );
}

/* ----------------------- بنر پایین (بعد از پرفروشترین) ----------------------- */

function BottomBanner() {
  const { builder } = useSiteSettings();
  return (
    <section className="mx-auto w-full max-w-[1240px] px-4 py-8 lg:px-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/wholesale" className="group relative overflow-hidden rounded-[1rem]">
          <img src="/images/model-front.jpg" alt="خرید عمده" loading="lazy" className="h-[150px] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] sm:h-[200px]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white">
            <h3 className="text-[17px] font-medium">خرید عمده</h3>
            <p className="mt-1 text-[11px] text-white/70">قیمت‌های ویژه برای کسب‌وکار شما</p>
          </div>
          <FestivalCountdownOverlay config={builder.components.countdown} where="bottomWholesale" />
        </Link>
        <Link to="/styles" className="group relative overflow-hidden rounded-[1rem]">
          <img src="/images/detail-hem.jpg" alt="استایل‌ها" loading="lazy" className="h-[150px] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] sm:h-[200px]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white">
            <h3 className="text-[17px] font-medium">استایل‌های کلبه</h3>
            <p className="mt-1 text-[11px] text-white/70">از دارک آکادمیا تا اولد مانی</p>
          </div>
          <FestivalCountdownOverlay config={builder.components.countdown} where="bottomStyles" />
        </Link>
      </div>
    </section>
  );
}
