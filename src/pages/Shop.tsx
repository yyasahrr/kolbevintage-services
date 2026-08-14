import { useEffect, useMemo, useState } from "react";
import { useRouter } from "../router";
import {
  products,
  categories,
  seasons,
  fabricGroups,
  filterColours,
  allSizes,
  type Product,
} from "../data/catalog";
import { styles } from "../siteData";
import { fa } from "../utils/format";
import ProductCard from "../components/ProductCard";
import Icon from "../components/Icon";

type Filters = {
  cats: string[];
  sizes: string[];
  colours: string[];
  styles: string[];
  seasons: string[];
  fabrics: string[];
  min: string;
  max: string;
};

const emptyFilters: Filters = {
  cats: [],
  sizes: [],
  colours: [],
  styles: [],
  seasons: [],
  fabrics: [],
  min: "",
  max: "",
};

const sortOptions = [
  { id: "new", label: "جدیدترین" },
  { id: "best", label: "پرفروش‌ترین" },
  { id: "cheap", label: "ارزان‌ترین" },
  { id: "expensive", label: "گران‌ترین" },
  { id: "rating", label: "بیشترین امتیاز" },
];

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-neutral-200 py-3.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-right">
        <span className="text-[12.5px] font-medium">{title}</span>
        <Icon name={open ? "minus" : "plus"} className="h-3.5 w-3.5 text-neutral-400" />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-[12px]">
      <span
        onClick={onChange}
        className={
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border transition " +
          (checked ? "border-[#011c3a] bg-[#011c3a]" : "border-neutral-300")
        }
      >
        {checked && <Icon name="check" className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      </span>
      <span onClick={onChange} className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[11px] text-neutral-400 num-fa">{fa(count)}</span>}
    </label>
  );
}

function FilterPanel({
  f,
  set,
  reset,
  results,
}: {
  f: Filters;
  set: (patch: Partial<Filters>) => void;
  reset: () => void;
  results: number;
}) {
  const toggle = (key: keyof Filters, value: string) => {
    const arr = f[key] as string[];
    set({ [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] } as Partial<Filters>);
  };

  const countBy = (fn: (p: Product) => boolean) => products.filter(fn).length;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
        <span className="text-[12.5px] font-medium">فیلترها</span>
        <button onClick={reset} className="text-[11.5px] text-neutral-500 underline hover:text-[#011c3a]">
          پاک کردن همه
        </button>
      </div>

      <Section title="دسته‌بندی">
        {categories.map((c) => (
          <CheckRow
            key={c.slug}
            label={c.label}
            count={countBy((p) => p.category === c.slug)}
            checked={f.cats.includes(c.slug)}
            onChange={() => toggle("cats", c.slug)}
          />
        ))}
      </Section>

      <Section title="سبک">
        {styles.map((s) => (
          <CheckRow
            key={s.slug}
            label={`${s.name} / ${s.latin}`}
            count={countBy((p) => p.style === s.slug)}
            checked={f.styles.includes(s.slug)}
            onChange={() => toggle("styles", s.slug)}
          />
        ))}
      </Section>

      <Section title="سایز">
        <div className="grid grid-cols-4 gap-1.5">
          {allSizes.map((s) => (
            <button
              key={s}
              onClick={() => toggle("sizes", s)}
              className={
                "h-8 rounded-[3px] border text-[11.5px] transition " +
                (f.sizes.includes(s) ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]")
              }
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      <Section title="رنگ">
        <div className="flex flex-wrap gap-2">
          {filterColours.map((c) => (
            <button
              key={c.name}
              onClick={() => toggle("colours", c.name)}
              title={c.name}
              aria-label={c.name}
              className={
                "h-7 w-7 rounded-full border-2 transition " +
                (f.colours.includes(c.name) ? "border-[#011c3a]" : "border-neutral-200 hover:border-neutral-400")
              }
              style={{ background: c.hex }}
            />
          ))}
        </div>
      </Section>

      <Section title="قیمت (تومان)">
        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={f.min}
            onChange={(e) => set({ min: e.target.value.replace(/\D/g, "") })}
            placeholder="از"
            className="h-9 w-full rounded-[3px] border border-neutral-300 px-2.5 text-[12px] outline-none focus:border-[#011c3a]"
          />
          <span className="text-neutral-400">—</span>
          <input
            inputMode="numeric"
            value={f.max}
            onChange={(e) => set({ max: e.target.value.replace(/\D/g, "") })}
            placeholder="تا"
            className="h-9 w-full rounded-[3px] border border-neutral-300 px-2.5 text-[12px] outline-none focus:border-[#011c3a]"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { l: "زیر ۲ میلیون", min: "", max: "2000000" },
            { l: "۲ تا ۴ میلیون", min: "2000000", max: "4000000" },
            { l: "بالای ۴ میلیون", min: "4000000", max: "" },
          ].map((r) => (
            <button
              key={r.l}
              onClick={() => set({ min: r.min, max: r.max })}
              className="rounded-[3px] border border-neutral-300 px-2.5 py-1 text-[10.5px] hover:border-[#011c3a]"
            >
              {r.l}
            </button>
          ))}
        </div>
      </Section>

      <Section title="فصل" defaultOpen={false}>
        {seasons.map((s) => (
          <CheckRow key={s} label={s} checked={f.seasons.includes(s)} onChange={() => toggle("seasons", s)} />
        ))}
      </Section>

      <Section title="جنس پارچه" defaultOpen={false}>
        {fabricGroups.map((s) => (
          <CheckRow
            key={s}
            label={s}
            count={countBy((p) => p.fabricGroup === s)}
            checked={f.fabrics.includes(s)}
            onChange={() => toggle("fabrics", s)}
          />
        ))}
      </Section>

      <p className="pt-4 text-[11.5px] text-neutral-500 num-fa">{fa(results)} محصول یافت شد</p>
    </div>
  );
}

export default function Shop() {
  const { query } = useRouter();
  const [f, setF] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState(query.get("sort") ?? "new");
  const [cols, setCols] = useState(3);
  const [mobileCols, setMobileCols] = useState(2);
  const [shown, setShown] = useState(9);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const cat = query.get("cat");
    const s = query.get("s");
    const next = { ...emptyFilters, cats: cat ? [cat] : [], styles: s ? [s] : [] };
    setF(next);
    setDraft(next);
    setSort(query.get("sort") ?? "new");
    setShown(9);
  }, [query.toString()]);

  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  const filtered = useMemo(() => {
    let out = products.filter((p) => {
      if (f.cats.length && !f.cats.includes(p.category)) return false;
      if (f.styles.length && !f.styles.includes(p.style)) return false;
      if (f.seasons.length && !f.seasons.includes(p.season)) return false;
      if (f.fabrics.length && !f.fabrics.includes(p.fabricGroup)) return false;
      if (f.sizes.length && !p.sizes.some((s) => f.sizes.includes(s.label) && s.inStock)) return false;
      if (f.min && p.price < Number(f.min)) return false;
      if (f.max && p.price > Number(f.max)) return false;
      if (f.colours.length) {
        const names = f.colours;
        const hit = p.colours.some((c) =>
          names.some((n) => {
            const target = filterColours.find((x) => x.name === n)!.hex;
            return nearColour(c.hex, target);
          }),
        );
        if (!hit) return false;
      }
      return true;
    });

    const by: Record<string, (a: Product, b: Product) => number> = {
      new: (a, b) => b.createdAt - a.createdAt,
      best: (a, b) => b.sold - a.sold,
      cheap: (a, b) => a.price - b.price,
      expensive: (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating,
    };
    out = [...out].sort(by[sort] ?? by.new);
    return out;
  }, [f, sort]);

  const activeCount =
    f.cats.length + f.styles.length + f.sizes.length + f.colours.length + f.seasons.length + f.fabrics.length + (f.min ? 1 : 0) + (f.max ? 1 : 0);

  const applyDraft = () => {
    setF(draft);
    setShown(9);
    setDrawer(false);
  };

  const resetAll = () => {
    setDraft(emptyFilters);
    setF(emptyFilters);
    setShown(9);
  };

  const gridClass =
    `grid gap-x-3 gap-y-8 ` +
    (mobileCols === 1 ? "grid-cols-1 " : "grid-cols-2 ") +
    (cols === 2 ? "lg:grid-cols-2" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4");

  return (
    <main className="mx-auto w-full px-4 py-8 lg:px-8 lg:py-12">
      <nav className="mb-4 flex items-center gap-1.5 text-[11px] text-neutral-500">
        <a href="#/" className="hover:underline">خانه</a>
        <span>›</span>
        <span className="text-[#011c3a]">فروشگاه</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-[24px] font-medium lg:text-[28px]">همه محصولات</h1>
        <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-neutral-500">
          قطعات دست‌دوز کلبه وینتیج در پنج استایل. با فیلترها دقیقاً همان چیزی را پیدا کنید که دنبالش هستید.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[248px_1fr] lg:gap-10">
        {/* فیلتر دسکتاپ */}
        <aside className="hidden self-start lg:sticky lg:top-[124px] lg:block">
          <FilterPanel f={draft} set={set} reset={resetAll} results={filtered.length} />
          <button
            onClick={applyDraft}
            className="mt-4 h-10 w-full rounded-[3px] bg-[#011c3a] text-[12.5px] font-medium text-white transition hover:bg-[#0a2c55]"
          >
            اعمال فیلتر
          </button>
        </aside>

        <div>
          {/* نوار ابزار */}
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-neutral-200 pb-4">
            <button
              onClick={() => setDrawer(true)}
              className="flex items-center gap-2 rounded-[3px] border border-neutral-300 px-3.5 py-2 text-[12px] lg:hidden"
            >
              فیلترها
              {activeCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#011c3a] px-1 text-[9px] text-white num-fa">
                  {fa(activeCount)}
                </span>
              )}
            </button>

            <span className="hidden text-[12px] text-neutral-500 num-fa lg:block">
              {fa(filtered.length)} محصول
            </span>

            <div className="mr-auto flex items-center gap-3">
              {/* تغییر تعداد ستون */}
              <div className="hidden items-center gap-1 lg:flex">
                {[2, 3, 4].map((c) => (
                  <button
                    key={c}
                    onClick={() => setCols(c)}
                    aria-label={`${c} ستون`}
                    className={
                      "flex h-7 w-7 items-center justify-center rounded-[3px] border text-[10px] transition " +
                      (cols === c ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300")
                    }
                  >
                    {fa(c)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 lg:hidden">
                {[1, 2].map((c) => (
                  <button
                    key={c}
                    onClick={() => setMobileCols(c)}
                    aria-label={`${c} ستون`}
                    className={
                      "flex h-7 w-7 items-center justify-center rounded-[3px] border text-[10px] transition " +
                      (mobileCols === c ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300")
                    }
                  >
                    {fa(c)}
                  </button>
                ))}
              </div>

              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="h-9 rounded-[3px] border border-neutral-300 bg-white px-2.5 text-[12px] outline-none focus:border-[#011c3a]"
              >
                {sortOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* برچسب فیلترهای فعال */}
          {activeCount > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              {[...f.cats.map((c) => categories.find((x) => x.slug === c)?.label),
                ...f.styles.map((s) => styles.find((x) => x.slug === s)?.name),
                ...f.sizes,
                ...f.colours,
                ...f.seasons,
                ...f.fabrics,
              ]
                .filter(Boolean)
                .map((label) => (
                  <span key={label as string} className="rounded-[3px] bg-[#f6f6f4] px-2.5 py-1 text-[11px]">
                    {label}
                  </span>
                ))}
              <button onClick={resetAll} className="text-[11px] text-neutral-500 underline">
                حذف فیلترها
              </button>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-[13px] text-neutral-500">محصولی با این فیلترها پیدا نشد.</p>
              <button onClick={resetAll} className="mt-4 rounded-[3px] bg-[#011c3a] px-6 py-2.5 text-[12.5px] text-white">
                پاک کردن فیلترها
              </button>
            </div>
          ) : (
            <>
              <div className={gridClass}>
                {filtered.slice(0, shown).map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>

              {shown < filtered.length && (
                <div className="mt-12 text-center">
                  <button
                    onClick={() => setShown((s) => s + 9)}
                    className="rounded-[3px] border border-[#011c3a] px-10 py-3 text-[12.5px] font-medium transition hover:bg-[#011c3a] hover:text-white"
                  >
                    نمایش بیشتر ({fa(filtered.length - shown)} محصول دیگر)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* کشوی فیلتر موبایل */}
      {drawer && (
        <div className="fixed inset-0 z-[95] lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[88%] max-w-[340px] flex-col bg-white">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <span className="text-[14px] font-medium">فیلترها</span>
              <button onClick={() => setDrawer(false)} aria-label="بستن">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              <FilterPanel f={draft} set={set} reset={resetAll} results={filtered.length} />
            </div>
            <div className="border-t border-neutral-200 p-4">
              <button
                onClick={applyDraft}
                className="h-11 w-full rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white"
              >
                نمایش نتایج
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* تشخیص نزدیکی رنگ برای فیلتر رنگ */
function nearColour(a: string, b: string) {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const d = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  return d < 90;
}
