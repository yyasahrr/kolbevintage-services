import { Link } from "../router";
import { products } from "../data/catalog";
import { looks } from "../siteData";
import ProductCard from "../components/ProductCard";

export default function Collection() {
  const items = products.filter((p) => p.badges.includes("کالکشن پاییز") || p.season.includes("پاییز"));

  return (
    <main>
      <section className="relative h-[70vh] min-h-[420px] w-full overflow-hidden">
        <img src="/images/banner.jpg" alt="کالکشن پاییز ۱۴۰۵" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/80">AUTUMN 1405</p>
          <h1 className="mt-4 text-[30px] font-medium lg:text-[44px]">کالکشن پاییز</h1>
          <p className="mx-auto mt-4 max-w-lg text-[13px] leading-relaxed text-white/85">
            پشم شورون، بافت کابلی و کشمیر — سیزده قطعه برای سردترین روزهای سال.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full px-4 py-14 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[20px] font-medium">داستان این کالکشن</h2>
          <p className="mt-4 text-[13px] leading-[2.1] text-neutral-600">
            پاییز امسال را با پارچه‌هایی شروع کردیم که وزن دارند. پشم شورون از یک کارگاه قدیمی، آلپاکای نرم برای بافت‌ها
            و کشمیری که فقط برای پالتو کنار گذاشته شد. هر قطعه در کارگاه کلبه با دست تکمیل شده و پیش از ارسال، سه بار
            بازرسی می‌شود.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="bg-[#f6f6f4] py-14 lg:py-20">
        <div className="mx-auto w-full px-4 lg:px-8">
          <h2 className="mb-8 text-center text-[20px] font-medium">ست‌های این کالکشن</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {looks.map((l) => (
              <Link key={l.id} to="/" className="group relative overflow-hidden bg-neutral-200">
                <img
                  src={l.img}
                  alt={l.title}
                  loading="lazy"
                  className="aspect-[3/4] w-full object-cover transition-opacity group-hover:opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                  <p className="text-[10px] tracking-[0.25em] text-white/70">{l.season}</p>
                  <h3 className="mt-1.5 text-[15px] font-medium">{l.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
