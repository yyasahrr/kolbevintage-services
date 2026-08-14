import { useEffect, useState } from "react";
import { Link, useRouter } from "../router";
import { styles } from "../siteData";
import { products } from "../data/catalog";
import { fa } from "../utils/format";
import ProductCard from "../components/ProductCard";

export default function Styles() {
  const { query } = useRouter();
  const [active, setActive] = useState(0);

  useEffect(() => {
    const s = query.get("s");
    const i = styles.findIndex((x) => x.slug === s);
    if (i >= 0) setActive(i);
  }, [query.toString()]);

  const style = styles[active];
  const items = products.filter((p) => p.style === style.slug);

  return (
    <main>
      {/* هیرو استایل */}
      <section className="relative h-[52vh] min-h-[340px] w-full overflow-hidden">
        <img src={style.img} alt={style.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/75">{style.latin.toUpperCase()}</p>
          <h1 className="mt-3 text-[28px] font-medium lg:text-[38px]">{style.name}</h1>
          <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-white/85">{style.tagline}</p>
        </div>
      </section>

      {/* تب استایل‌ها */}
      <div className="sticky top-[104px] z-30 border-b border-neutral-200 bg-white">
        <div className="no-scrollbar mx-auto flex w-full gap-2 overflow-x-auto px-4 py-3 lg:justify-center lg:px-8">
          {styles.map((s, i) => (
            <button
              key={s.slug}
              onClick={() => setActive(i)}
              className={
                "shrink-0 rounded-[3px] border px-4 py-2 text-[12px] transition " +
                (i === active ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]")
              }
            >
              {s.name}
              <span className="mr-1.5 text-[9px] tracking-widest opacity-60">{s.latin.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="mx-auto w-full px-4 py-12 lg:px-8 lg:py-16">
        <div className="mb-10 grid gap-8 lg:grid-cols-[1fr_320px] lg:gap-16">
          <div>
            <h2 className="text-[20px] font-medium">{style.name}</h2>
            <p className="mt-4 text-[13px] leading-[2.1] text-neutral-600">{style.description}</p>
          </div>
          <div>
            <p className="text-[12px] font-medium">پالت رنگی این استایل</p>
            <div className="mt-3 flex gap-2">
              {style.swatches.map((c) => (
                <span key={c} className="h-12 flex-1 rounded-[3px] border border-neutral-200" style={{ background: c }} />
              ))}
            </div>
            <p className="mt-4 text-[11.5px] text-neutral-500 num-fa">{fa(items.length)} محصول در این استایل</p>
            <Link
              to={`/shop?s=${style.slug}`}
              className="mt-4 inline-block rounded-[3px] border border-[#011c3a] px-6 py-2.5 text-[12px] font-medium transition hover:bg-[#011c3a] hover:text-white"
            >
              مشاهده در فروشگاه
            </Link>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="py-16 text-center text-[13px] text-neutral-500">
            به‌زودی محصولات این استایل اضافه می‌شوند.
          </p>
        )}
      </section>
    </main>
  );
}
