import { useMemo, useState } from "react";
import { Link } from "../router";
import { articles } from "../siteData";
import { products } from "../data/catalog";
import { fa } from "../utils/format";
import ProductCard from "../components/ProductCard";

export function BlogList() {
  const cats = useMemo(() => ["همه", ...new Set(articles.map((a) => a.category))], []);
  const [cat, setCat] = useState("همه");
  const items = cat === "همه" ? articles : articles.filter((a) => a.category === cat);
  const [hero, ...rest] = items;

  return (
    <main className="storefront-page mx-auto w-full px-4 py-10 lg:px-8 lg:py-16">
      <div className="mb-8 text-center">
        <p className="text-[11px] tracking-[0.3em] text-neutral-400">JOURNAL</p>
        <h1 className="mt-2 text-[26px] font-medium lg:text-[32px]">مجله استایل</h1>
        <p className="mx-auto mt-3 max-w-lg text-[12.5px] leading-relaxed text-neutral-500">
          راهنمای استایل، نگهداری از لباس و پشت صحنه کارگاه کلبه.
        </p>
      </div>

      <div className="mb-10 flex flex-wrap justify-center gap-2">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={
              "rounded-[3px] border px-3.5 py-1.5 text-[11.5px] transition " +
              (cat === c ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {c}
          </button>
        ))}
      </div>

      {hero && (
        <Link to={`/blog/${hero.slug}`} className="editorial-tile group relative mb-4 block overflow-hidden bg-neutral-200">
          <img
            src={hero.img}
            alt={hero.title}
            className="aspect-[16/10] w-full object-cover transition-opacity group-hover:opacity-90 lg:aspect-[21/9]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-white lg:p-10">
            <span className="text-[10px] tracking-[0.25em] text-white/70">{hero.category}</span>
            <h2 className="mt-3 max-w-2xl text-[20px] font-medium leading-relaxed lg:text-[28px]">{hero.title}</h2>
            <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-white/80">{hero.excerpt}</p>
            <p className="mt-4 text-[11px] text-white/60">
              {hero.date} — {fa(hero.readTime)} دقیقه مطالعه
            </p>
          </div>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((a) => (
          <Link key={a.slug} to={`/blog/${a.slug}`} className="editorial-tile group relative overflow-hidden bg-neutral-200">
            <img
              src={a.img}
              alt={a.title}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-opacity group-hover:opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 text-white">
              <span className="text-[9.5px] tracking-[0.2em] text-white/70">{a.category}</span>
              <h3 className="mt-2 text-[14.5px] font-medium leading-relaxed">{a.title}</h3>
              <p className="mt-2 text-[10.5px] text-white/60">
                {a.date} — {fa(a.readTime)} دقیقه
              </p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

export function BlogPost({ slug }: { slug: string }) {
  const a = articles.find((x) => x.slug === slug);
  if (!a)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-[14px]">مقاله یافت نشد.</p>
      </div>
    );

  const related = products.slice(0, 4);
  const more = articles.filter((x) => x.slug !== slug).slice(0, 3);

  return (
    <main>
      <div className="page-hero relative h-[45vh] min-h-[300px] w-full overflow-hidden">
        <img src={a.img} alt={a.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/20" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <span className="text-[10px] tracking-[0.3em] text-white/70">{a.category}</span>
          <h1 className="mt-3 max-w-3xl text-[22px] font-medium leading-relaxed lg:text-[32px]">{a.title}</h1>
          <p className="mt-4 text-[11.5px] text-white/70">
            {a.date} — {fa(a.readTime)} دقیقه مطالعه
          </p>
        </div>
      </div>

      <div className="mx-auto grid w-full gap-10 px-4 py-12 lg:grid-cols-[220px_1fr] lg:gap-16 lg:px-8 lg:py-16">
        {/* فهرست مطالب */}
        <aside className="liquid-panel self-start lg:sticky lg:top-[82px]">
          <p className="text-[12px] font-medium">فهرست مطالب</p>
          <ol className="mt-3 space-y-2 border-r border-neutral-200 pr-3">
            {a.body.map((p, i) => (
              <li key={i}>
                <a href={`#p-${i}`} className="text-[11.5px] leading-relaxed text-neutral-500 hover:text-[#011c3a]">
                  {fa(i + 1)}. {p.slice(0, 34)}…
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <article className="max-w-2xl">
          <p className="text-[14px] leading-[2.2] text-neutral-700">{a.excerpt}</p>
          <div className="mt-6 space-y-5">
            {a.body.map((p, i) => (
              <p key={i} id={`p-${i}`} className="text-[13px] leading-[2.2] text-neutral-600">
                {p}
              </p>
            ))}
          </div>

          <div className="mt-12 border-t border-neutral-200 pt-8">
            <h3 className="mb-5 text-[16px] font-medium">محصولات مرتبط با این مقاله</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 lg:grid-cols-4">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} compact />
              ))}
            </div>
          </div>
        </article>
      </div>

      <section className="bg-[#f6f6f4] py-14">
        <div className="mx-auto w-full px-4 lg:px-8">
          <h3 className="mb-6 text-[17px] font-medium">مقالات دیگر</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {more.map((m) => (
              <Link key={m.slug} to={`/blog/${m.slug}`} className="editorial-tile group relative overflow-hidden bg-neutral-200">
                <img src={m.img} alt={m.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  <h4 className="text-[13px] font-medium leading-relaxed">{m.title}</h4>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
