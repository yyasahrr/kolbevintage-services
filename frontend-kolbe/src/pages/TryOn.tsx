import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { products, type Product } from "../data/catalog";
import { Link, useRouter } from "../router";

type SlotKey = "top" | "trouser" | "shoe";

const slotMeta: Array<{ key: SlotKey; title: string; hint: string }> = [
  { key: "top", title: "بالاتنه", hint: "کت، پیراهن یا بافت" },
  { key: "trouser", title: "شلوار", hint: "فرم و رنگ پایین‌تنه" },
  { key: "shoe", title: "کفش و اکسسوری", hint: "تکمیل استایل" },
];

function optionsFor(key: SlotKey) {
  if (key === "trouser") return products.filter((p) => p.category === "trouser");
  if (key === "shoe") return products.filter((p) => p.category === "accessory");
  return products.filter((p) => ["blazer", "shirt", "knit"].includes(p.category));
}

export default function TryOn() {
  const { query } = useRouter();
  const initialTop = products.find((p) => p.id === query.get("top")) ?? optionsFor("top")[0];
  const [selected, setSelected] = useState<Record<SlotKey, Product>>({
    top: initialTop,
    trouser: optionsFor("trouser")[0],
    shoe: optionsFor("shoe")[0],
  });
  const [portrait, setPortrait] = useState("");
  const [ready, setReady] = useState(false);
  const selectedItems = useMemo(() => slotMeta.map((slot) => selected[slot.key]), [selected]);

  useEffect(() => () => { if (portrait) URL.revokeObjectURL(portrait); }, [portrait]);

  return (
    <main className="tryon-page px-3 pb-8 pt-5 sm:px-5 lg:px-8 lg:pt-8">
      <section className="tryon-intro mx-auto grid max-w-[1240px] gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="tryon-copy liquid-panel flex flex-col justify-between p-6 sm:p-8">
          <div>
            <span className="ai-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] tracking-[0.14em]">
              <Icon name="star" className="h-3.5 w-3.5" /> KOLBE AI STUDIO
            </span>
            <h1 className="mt-5 text-[30px] font-medium leading-[1.45] sm:text-[40px]">یک استایل کامل را روی تصویر خودت ببین</h1>
            <p className="mt-3 max-w-xl text-[13px] leading-[2] text-neutral-500">
              بالاتنه، شلوار و کفش را جداگانه انتخاب کن. این قالب برای اتصال به مدل اختصاصی تولید تصویر کلبه آماده شده است.
            </p>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-2 text-center text-[10.5px]">
            {["انتخاب سه لایه", "آپلود یک تصویر", "ساخت پیش‌نمایش"].map((item, index) => (
              <div key={item} className="tryon-step rounded-2xl px-2 py-3"><span className="mb-1 block text-[15px]">{index + 1}</span>{item}</div>
            ))}
          </div>
        </div>

        <div className="tryon-preview liquid-panel min-h-[460px] p-3 sm:p-4">
          <div className="tryon-preview-canvas relative flex min-h-[430px] items-center justify-center overflow-hidden rounded-[1.5rem]">
            {portrait ? (
              <img src={portrait} alt="تصویر انتخاب‌شده برای پرو مجازی" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="text-center">
                <Icon name="user" className="mx-auto h-14 w-14 opacity-35" />
                <p className="mt-3 text-[12px] text-neutral-500">برای نتیجه شخصی‌تر، یک تصویر تمام‌قد اضافه کن</p>
              </div>
            )}
            <div className="absolute inset-x-3 bottom-3 grid grid-cols-3 gap-2">
              {selectedItems.map((item, index) => (
                <div key={slotMeta[index].key} className="tryon-selected-item flex items-center gap-2 rounded-2xl p-2">
                  <img src={item.images[0]} alt="" className="h-12 w-10 rounded-xl object-cover" />
                  <span className="min-w-0 text-[10.5px]"><b className="block truncate font-medium">{item.name}</b><span className="opacity-60">{slotMeta[index].title}</span></span>
                </div>
              ))}
            </div>
            {ready && <div className="tryon-ready absolute right-4 top-4 rounded-full px-4 py-2 text-[11px]">پیش‌نمایش قالب آماده است</div>}
          </div>
        </div>
      </section>

      <section className="tryon-builder liquid-panel mx-auto mt-5 max-w-[1240px] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-[19px] font-medium">استایل خودت را بساز</h2><p className="mt-1 text-[11.5px] text-neutral-500">هر لایه مستقل انتخاب و در خروجی نهایی ترکیب می‌شود.</p></div>
          <label className="storefront-secondary-action cursor-pointer rounded-full px-5 py-2.5 text-[12px]">
            آپلود تصویر
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (portrait) URL.revokeObjectURL(portrait);
              setPortrait(URL.createObjectURL(file));
              setReady(false);
            }} />
          </label>
        </div>

        <div className="mt-6 space-y-5">
          {slotMeta.map((slot) => (
            <div key={slot.key} className="tryon-slot">
              <div className="mb-3 flex items-end justify-between"><h3 className="text-[14px] font-medium">{slot.title}</h3><span className="text-[10.5px] text-neutral-400">{slot.hint}</span></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {optionsFor(slot.key).slice(0, 5).map((item) => (
                  <button key={item.id} type="button" onClick={() => { setSelected((current) => ({ ...current, [slot.key]: item })); setReady(false); }} className={`tryon-option flex items-center gap-2 rounded-2xl p-2 text-right ${selected[slot.key].id === item.id ? "is-selected" : ""}`}>
                    <img src={item.images[0]} alt="" className="h-16 w-12 shrink-0 rounded-xl object-cover" />
                    <span className="min-w-0 text-[11px]"><b className="block truncate font-medium">{item.name}</b><span className="mt-1 block truncate text-neutral-400">{item.categoryLabel}</span></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10.5px] leading-6 text-neutral-500">نسخهٔ فعلی یک تمپلیت تعاملی است و برای تولید تصویر نهایی باید به سرویس مدل متصل شود.</p>
          <button type="button" onClick={() => setReady(true)} className="ai-tryon-button flex min-h-12 items-center justify-center gap-2 rounded-full px-7 text-[12.5px] font-medium">
            <Icon name="star" className="h-4 w-4" /> ساخت پیش‌نمایش هوشمند
          </button>
        </div>
      </section>

      <div className="mx-auto mt-4 max-w-[1240px] text-center"><Link to="/shop" className="text-[11.5px] underline underline-offset-4">بازگشت به فروشگاه</Link></div>
    </main>
  );
}
