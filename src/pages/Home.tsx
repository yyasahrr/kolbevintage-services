import { useState } from "react";
import { Link } from "../router";
import { products } from "../data/catalog";
import { styles, looks, articles, trustBadges } from "../siteData";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import ProductCard from "../components/ProductCard";
import Icon from "../components/Icon";

/* ---------------------------------- ۱. هیرو ---------------------------------- */

function Hero() {
  return (
    <section className="relative h-[100svh] min-h-[560px] w-full overflow-hidden bg-neutral-200">
      <img
        src="/images/model-front.jpg"
        alt="کالکشن پاییز کلبه وینتیج"
        fetchPriority="high"
        decoding="async"
        className="h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />

      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="fade-up max-w-2xl text-center text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/80">کالکشن پاییز ۱۴۰۵</p>
          <h1 className="mt-4 text-[32px] font-medium leading-[1.35] sm:text-[42px] lg:text-[52px]">
            لباسی که با گذر زمان
            <br />
            زیباتر می‌شود
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[13px] leading-relaxed text-white/85 sm:text-[14px]">
            پارچه‌های نجیب، برش‌های کلاسیک و دوخت دست در کارگاه کلبه. قطعاتی که یک عمر همراه شما می‌مانند.
          </p>
          <Link
            to="/collection"
            className="mt-8 inline-flex items-center gap-2 rounded-[3px] bg-white px-8 py-3 text-[13px] font-medium text-[#011c3a] transition hover:bg-neutral-100"
          >
            مشاهده کالکشن
          </Link>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70">
        <Icon name="chevronDown" className="h-5 w-5 animate-bounce" />
      </div>
    </section>
  );
}

/* ------------------------------ ۲. جدیدترین کالکشن ---------------------------- */

function NewArrivals() {
  const items = [...products].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const [hero, ...rest] = items;

  return (
    <section className="mx-auto w-full px-4 py-16 lg:px-8 lg:py-24">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.3em] text-neutral-400">NEW ARRIVALS</p>
          <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">جدیدترین کالکشن</h2>
        </div>
        <Link to="/shop?sort=new" className="shrink-0 text-[12.5px] underline underline-offset-4 hover:no-underline">
          مشاهده همه
        </Link>
      </div>

      {/* گرید نامتقارن: یکی بزرگ + بقیه کوچک */}
      <div className="grid gap-x-4 gap-y-8 lg:grid-cols-[1.25fr_1fr_1fr]">
        <div className="lg:row-span-2">
          <ProductCard product={hero} />
        </div>
        {rest.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ ۳. بنر کالکشن ------------------------------- */

function CollectionBanner() {
  return (
    <section className="relative h-[70vh] min-h-[420px] w-full overflow-hidden">
      <img
        src="/images/banner.jpg"
        alt="کالکشن پاییز"
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" />
      <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-white">
        <div>
          <p className="text-[11px] tracking-[0.4em] text-white/80">AUTUMN COLLECTION</p>
          <h2 className="mt-4 text-[26px] font-medium leading-snug sm:text-[34px] lg:text-[40px]">
            پاییز، فصل پارچه‌های سنگین
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[13px] leading-relaxed text-white/85">
            پشم شورون، بافت کابلی و کشمیر. کالکشنی که برای سردترین روزهای سال دوخته شده است.
          </p>
          <Link
            to="/collection"
            className="mt-7 inline-block rounded-[3px] bg-white px-8 py-3 text-[13px] font-medium text-[#011c3a] transition hover:bg-neutral-100"
          >
            کاوش در کالکشن
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- ۴. خرید بر اساس استایل --------------------------- */

function ShopByStyle() {
  return (
    <section className="mx-auto w-full px-4 py-16 lg:px-8 lg:py-24">
      <div className="mb-8 text-center">
        <p className="text-[11px] tracking-[0.3em] text-neutral-400">SHOP BY STYLE</p>
        <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">خرید بر اساس استایل</h2>
        <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-neutral-500">
          پنج زبان پوشش که کمد کلبه وینتیج بر پایه آن‌ها ساخته شده است.
        </p>
      </div>

      {/* گرید نامتقارن ۲ + ۳ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {styles.map((s, i) => (
          <Link
            key={s.slug}
            to={`/styles?s=${s.slug}`}
            className={
              "group relative overflow-hidden bg-neutral-100 " +
              (i < 2 ? "lg:col-span-3" : "lg:col-span-2")
            }
          >
            <img
              src={s.img}
              alt={s.name}
              loading="lazy"
              decoding="async"
              className={
                "w-full object-cover transition-opacity duration-500 group-hover:opacity-90 " +
                (i < 2 ? "aspect-[16/10]" : "aspect-[4/5]")
              }
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 text-white">
              <h3 className="text-[17px] font-medium lg:text-[19px]">{s.name}</h3>
              <p className="mt-0.5 text-[10px] tracking-[0.25em] text-white/70">{s.latin.toUpperCase()}</p>
              <p className="mt-2 text-[11.5px] text-white/80">{fa(s.count)} محصول</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- ۵. پرفروش‌ترین‌ها ------------------------------ */

function BestSellers() {
  const items = [...products].sort((a, b) => b.sold - a.sold).slice(0, 8);

  return (
    <section className="bg-[#f6f6f4] py-16 lg:py-24">
      <div className="mx-auto w-full px-4 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-neutral-400">BESTSELLERS</p>
            <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">پرفروش‌ترین محصولات</h2>
          </div>
          <Link to="/shop?sort=best" className="shrink-0 text-[12.5px] underline underline-offset-4 hover:no-underline">
            مشاهده همه
          </Link>
        </div>

        <div className="rtl-rail no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {items.map((p) => (
            <div key={p.id} className="w-[62%] shrink-0 sm:w-[38%] lg:w-[23.5%]">
              <ProductCard product={p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- ۶. ویدئو --------------------------------- */

function BrandVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="relative h-[75vh] min-h-[440px] w-full overflow-hidden bg-black">
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
  const look = looks[active];
  const total = look.items.reduce((s, i) => s + i.price, 0);

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
    <section className="mx-auto w-full px-4 py-16 lg:px-8 lg:py-24">
      <div className="mb-8 text-center">
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
              "rounded-[3px] border px-4 py-1.5 text-[11.5px] transition " +
              (i === active ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {l.season}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
        {/* عکس با نقطه‌های تعاملی */}
        <div className="relative overflow-hidden bg-neutral-100">
          <img
            src={look.img}
            alt={look.title}
            loading="lazy"
            decoding="async"
            className="aspect-[4/5] w-full object-cover lg:aspect-[3/4]"
          />
          {look.items.map((item, i) => {
            const pos = [
              { top: "26%", right: "38%" },
              { top: "58%", right: "45%" },
              { top: "16%", right: "60%" },
            ][i];
            return (
              <button
                key={item.productId}
                title={item.name}
                className="group absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white/40 backdrop-blur transition hover:bg-white"
                style={pos}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white group-hover:bg-[#011c3a]" />
                <span className="pointer-events-none absolute top-8 whitespace-nowrap rounded-[3px] bg-[#011c3a] px-2 py-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>

        <div className="self-center">
          <p className="text-[11px] tracking-[0.25em] text-neutral-400">{look.season.toUpperCase()}</p>
          <h3 className="mt-2 text-[20px] font-medium lg:text-[24px]">{look.title}</h3>

          <div className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200">
            {look.items.map((item) => {
              const p = products.find((x) => x.id === item.productId);
              return (
                <div key={item.productId} className="flex items-center gap-3 py-3">
                  <Link to={`/product/${item.productId}`}>
                    <img src={p?.images[0]} alt={item.name} className="h-16 w-12 object-cover" loading="lazy" />
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
                    className="shrink-0 rounded-[3px] border border-neutral-300 px-3 py-1.5 text-[11px] transition hover:border-[#011c3a]"
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
            className="mt-4 flex h-11 w-full items-center justify-center rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55]"
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
  const items = articles.slice(0, 4);

  return (
    <section className="bg-[#f6f6f4] py-16 lg:py-24">
      <div className="mx-auto w-full px-4 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-neutral-400">JOURNAL</p>
            <h2 className="mt-2 text-[22px] font-medium lg:text-[26px]">مجله استایل</h2>
          </div>
          <Link to="/blog" className="shrink-0 text-[12.5px] underline underline-offset-4 hover:no-underline">
            همه مقالات
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((a) => (
            <Link key={a.slug} to={`/blog/${a.slug}`} className="group relative overflow-hidden bg-neutral-200">
              <img
                src={a.img}
                alt={a.title}
                loading="lazy"
                decoding="async"
                className="aspect-[3/4] w-full object-cover transition-opacity duration-500 group-hover:opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <span className="text-[9.5px] tracking-[0.2em] text-white/70">{a.category}</span>
                <h3 className="mt-2 text-[14px] font-medium leading-relaxed">{a.title}</h3>
                <p className="mt-2 text-[10.5px] text-white/65">{fa(a.readTime)} دقیقه مطالعه</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ ۹. اینستاگرام ------------------------------- */

function InstagramGrid() {
  const shots = [
    "/images/model-front.jpg",
    "/images/detail-collar.jpg",
    "/images/model-teal.jpg",
    "/images/flat.jpg",
    "/images/model-full.jpg",
    "/images/detail-hem.jpg",
  ];

  return (
    <section className="mx-auto w-full px-4 py-16 lg:px-8 lg:py-20">
      <div className="mb-6 text-center">
        <h2 className="text-[18px] font-medium lg:text-[20px]">@kolbevintage</h2>
        <p className="mt-2 text-[12px] text-neutral-500">ما را در اینستاگرام دنبال کنید</p>
      </div>
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
  return (
    <>
      <Hero />
      <NewArrivals />
      <CollectionBanner />
      <ShopByStyle />
      <BestSellers />
      <BrandVideo />
      <ShopTheLook />
      <Journal />
      <InstagramGrid />
      <TrustRow />
    </>
  );
}
