import { useRef, useState } from "react";
import {
  useSiteSettings, saveSiteSettings, defaultSiteBuilder,
  type SiteBuilder, type BuilderStyleCard, type BuilderPost, type BuilderInstaCard, type BuilderHotspot, type CountdownComponent,
} from "../siteSettings";
import { fileToOptimizedDataUrl } from "../lib/imageUpload";
import { VisualHotspotCanvas, ImageDropField, SortableList } from "../components/visualBuilder";
import HeroCountdown from "../components/HeroCountdown";
import { toman } from "../utils/format";

const input = "h-9 w-full rounded-[3px] border border-neutral-300 bg-white px-3 text-[12px] outline-none transition focus:border-[#011c3a]";
const label = "mb-1.5 block text-[10.5px] font-medium text-neutral-500";
const card = "rounded-[6px] border border-neutral-200 p-4";
const btn = "h-9 rounded-[3px] border border-neutral-300 px-3 text-[11px] transition hover:border-[#011c3a]";
const btnPrimary = "h-9 rounded-[3px] bg-[#011c3a] px-4 text-[11px] font-medium text-white transition hover:bg-[#0a2c55]";

type Tab = "card" | "banner" | "styles" | "popup" | "look" | "components" | "blog" | "instagram" | "footer";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "card", label: "کارت محصول" },
  { id: "banner", label: "بنر ساز" },
  { id: "styles", label: "کارت استایل‌ها" },
  { id: "popup", label: "پاپ‌آپ ساز" },
  { id: "look", label: "پیشنهاد استایل" },
  { id: "components", label: "کامپوننت‌ها" },
  { id: "blog", label: "مجله و بلاگ" },
  { id: "instagram", label: "اینستاگرام" },
  { id: "footer", label: "فوتر و خبرنامه" },
];

function ImageField({ value, onChange, hint }: { value: string; onChange: (url: string) => void; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <input className={input} dir="ltr" value={value.startsWith("data:") ? "(تصویر آپلودشده)" : value} onChange={(e) => onChange(e.target.value)} placeholder={hint ?? "/images/… یا https://…"} />
      <div className="mt-1.5 flex items-center gap-2">
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true); setError("");
          try { onChange(await fileToOptimizedDataUrl(file)); }
          catch { setError("خواندن تصویر ناموفق بود."); }
          finally { setBusy(false); }
        }} />
        <button type="button" className={btn} onClick={() => ref.current?.click()}>{busy ? "…" : "آپلود"}</button>
        {value ? <button type="button" className={btn} onClick={() => onChange("")}>حذف</button> : null}
        {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full cursor-pointer rounded-[3px] border border-neutral-300" />;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export default function SiteBuilder() {
  const settings = useSiteSettings();
  const builder = settings.builder;
  const [tab, setTab] = useState<Tab>("card");
  const [notice, setNotice] = useState("");
  const flash = (t: string) => { setNotice(t); window.setTimeout(() => setNotice(""), 2400); };

  const patch = (partial: Partial<SiteBuilder>) => saveSiteSettings({ ...settings, builder: { ...builder, ...partial } });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-medium">سایت‌ساز</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">همه بخش‌های صفحه اصلی اینجا قابل کاستوم‌کردن هستند. هر تغییری بلافاصله ذخیره و روی سایت اعمال می‌شود.</p>
        </div>
        <button onClick={() => { saveSiteSettings({ ...settings, builder: defaultSiteBuilder }); flash("به پیش‌فرض‌ها برگشت."); }} className={btn}>بازنشانی همه</button>
      </div>
      {notice ? <p role="status" className="rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">{notice}</p> : null}

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-neutral-200 pb-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={(tab === t.id ? "bg-[#011c3a] text-white" : "border-neutral-300 text-neutral-600 hover:border-[#011c3a]") + " shrink-0 rounded-full border px-4 py-1.5 text-[11px] transition"}>{t.label}</button>
        ))}
      </div>

      {/* ---------------- کارت محصول ---------------- */}
      {tab === "card" && (
        <section className={card}>
          <h3 className="text-[12.5px] font-medium">رنگ دکمه کارت محصول هنگام هاور</h3>
          <div className="mt-3 max-w-sm grid gap-3">
            <label className="block"><span className={label}>رنگ پس‌زمینه دکمه</span><ColorField value={builder.productCard.hoverBg} onChange={(v) => patch({ productCard: { ...builder.productCard, hoverBg: v } })} /></label>
            <label className="block"><span className={label}>رنگ متن داخل دکمه</span><ColorField value={builder.productCard.hoverText} onChange={(v) => patch({ productCard: { ...builder.productCard, hoverText: v } })} /></label>
          </div>
        </section>
      )}

      {/* ---------------- بنر ساز ---------------- */}
      {tab === "banner" && (
        <section className={card}>
          <h3 className="text-[12.5px] font-medium">بنر وسط صفحه اصلی (تصویر یا ویدیو)</h3>
          <div className="mt-3 space-y-3">
            <Row>
              <div>
                <span className={label}>چیدمان</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["single", "تمام‌صفحه"], ["split", "دو تکه"], ["grid3", "گرید ۳تکه"]] as const).map(([id, name]) => (
                    <button key={id} onClick={() => patch({ banner: { ...builder.banner, mode: id } })} className={(builder.banner.mode === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10.5px]"}>{name}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className={label}>نوع رسانه اصلی</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {([["image", "تصویر"], ["video", "ویدیو"]] as const).map(([id, name]) => (
                    <button key={id} onClick={() => patch({ banner: { ...builder.banner, mediaType: id } })} className={(builder.banner.mediaType === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10.5px]"}>{name}</button>
                  ))}
                </div>
              </div>
            </Row>
            <label className="block"><span className={label}>{builder.banner.mediaType === "video" ? "آدرس ویدیو (mp4/webm)" : "تصویر اصلی"}</span>
              <input className={input} dir="ltr" value={builder.banner.media} onChange={(e) => patch({ banner: { ...builder.banner, media: e.target.value } })} />
              {builder.banner.mediaType === "image" ? <div className="mt-1.5"><ImageDropField value={builder.banner.media} onChange={(url) => patch({ banner: { ...builder.banner, media: url } })} /></div> : <p className="mt-1 text-[9.5px] text-neutral-400">برای ویدیو آدرس مستقیم فایل را وارد کنید (مثلاً /videos/hero.mp4).</p>}
            </label>
            {builder.banner.mode === "grid3" && (
              <Row>
                <div><span className={label}>تصویر تکه دوم (درگ‌اند‌دراپ)</span><ImageDropField value={builder.banner.tile2} onChange={(url) => patch({ banner: { ...builder.banner, tile2: url } })} /></div>
                <div><span className={label}>تصویر تکه سوم (درگ‌اند‌دراپ)</span><ImageDropField value={builder.banner.tile3} onChange={(url) => patch({ banner: { ...builder.banner, tile3: url } })} /></div>
              </Row>
            )}
            <label className="block max-w-sm"><span className={label}>تیرگی پوشش: {Math.round(builder.banner.overlay * 100)}٪</span>
              <input type="range" min={0} max={85} value={Math.round(builder.banner.overlay * 100)} onChange={(e) => patch({ banner: { ...builder.banner, overlay: Number(e.target.value) / 100 } })} className="w-full accent-[#011c3a]" />
            </label>
            <Row>
              <label className="block"><span className={label}>بالانویس</span><input className={input} value={builder.banner.eyebrow} onChange={(e) => patch({ banner: { ...builder.banner, eyebrow: e.target.value } })} /></label>
              <label className="block"><span className={label}>تیتر</span><input className={input} value={builder.banner.title} onChange={(e) => patch({ banner: { ...builder.banner, title: e.target.value } })} /></label>
              <label className="block sm:col-span-2"><span className={label}>توضیح</span><textarea className="min-h-16 w-full rounded-[3px] border border-neutral-300 p-3 text-[12px]" value={builder.banner.description} onChange={(e) => patch({ banner: { ...builder.banner, description: e.target.value } })} /></label>
              <label className="block"><span className={label}>متن دکمه</span><input className={input} value={builder.banner.buttonLabel} onChange={(e) => patch({ banner: { ...builder.banner, buttonLabel: e.target.value } })} /></label>
              <label className="block"><span className={label}>لینک دکمه</span><input className={input} dir="ltr" value={builder.banner.buttonTo} onChange={(e) => patch({ banner: { ...builder.banner, buttonTo: e.target.value } })} /></label>
            </Row>
          </div>
        </section>
      )}

      {/* ---------------- کارت استایلها (ویرایشگر تصویری درگ‌اند‌دراپ) ---------------- */}
      {tab === "styles" && (
        <section className={card}>
          <div className="flex items-center justify-between">
            <h3 className="text-[12.5px] font-medium">کارت‌های استایل — ویرایشگر تصویری</h3>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={builder.stylesSection.fullBleed} onChange={(e) => patch({ stylesSection: { ...builder.stylesSection, fullBleed: e.target.checked } })} className="accent-[#011c3a]" />
              تمام‌عرض (فول‌سایز)
            </label>
          </div>
          <p className="mt-2 text-[10.5px] text-neutral-500">کارت را بگیر و جابه‌جا کن تا چینش عوض شود. روی کارت کلیک کن تا ویرایشش باز شود. اگر کارتی اضافه کنی، جای کارت‌های پیش‌فرض را می‌گیرند.</p>

          <div className="mt-4">
            <SortableList
              items={builder.stylesSection.cards.length > 0 ? builder.stylesSection.cards : []}
              onReorder={(cards) => patch({ stylesSection: { ...builder.stylesSection, cards } })}
              renderItem={(c, i) => (
                <StyleCardVisual key={c.id} card={c} onChange={(next) => { const cards = [...builder.stylesSection.cards]; cards[i] = next; patch({ stylesSection: { ...builder.stylesSection, cards } }); }} onRemove={() => patch({ stylesSection: { ...builder.stylesSection, cards: builder.stylesSection.cards.filter((x) => x.id !== c.id) } })} />
              )}
            />
            <button onClick={() => patch({ stylesSection: { ...builder.stylesSection, cards: [...builder.stylesSection.cards, { id: `st-${Date.now()}`, name: "استایل جدید", latin: "NEW STYLE", img: "/images/flat.jpg", tagline: "", count: "۰" }] } })} className={btnPrimary + " mt-3"}>+ کارت استایل جدید</button>
          </div>
        </section>
      )}

      {/* ---------------- پاپآپ ساز ---------------- */}
      {tab === "popup" && (
        <section className={card}>
          <div className="flex items-center justify-between">
            <h3 className="text-[12.5px] font-medium">پاپ‌آپ خبرنامه</h3>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={builder.popup.enabled} onChange={(e) => patch({ popup: { ...builder.popup, enabled: e.target.checked } })} className="accent-[#011c3a]" />
              فعال
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Row>
              <label className="block"><span className={label}>تأخیر نمایش (ثانیه)</span><input type="number" min={0} className={input} value={builder.popup.delaySec} onChange={(e) => patch({ popup: { ...builder.popup, delaySec: Number(e.target.value) } })} /></label>
              <div>
                <span className={label}>جهت (دایرکشن)</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {([["rtl", "راست‌به‌چپ"], ["ltr", "چپ‌به‌راست"]] as const).map(([id, name]) => (
                    <button key={id} onClick={() => patch({ popup: { ...builder.popup, direction: id } })} className={(builder.popup.direction === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10.5px]"}>{name}</button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <span className={label}>جایگاه</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["center", "وسط صفحه"], ["bottom-right", "پایین راست"], ["bottom-left", "پایین چپ"]] as const).map(([id, name]) => (
                    <button key={id} onClick={() => patch({ popup: { ...builder.popup, position: id } })} className={(builder.popup.position === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10.5px]"}>{name}</button>
                  ))}
                </div>
              </div>
              <label className="block"><span className={label}>رنگ پس‌زمینه</span><ColorField value={builder.popup.bg} onChange={(v) => patch({ popup: { ...builder.popup, bg: v } })} /></label>
              <label className="block"><span className={label}>رنگ متن</span><ColorField value={builder.popup.textColor} onChange={(v) => patch({ popup: { ...builder.popup, textColor: v } })} /></label>
              <label className="block"><span className={label}>رنگ تأکید (دکمه)</span><ColorField value={builder.popup.accent} onChange={(v) => patch({ popup: { ...builder.popup, accent: v } })} /></label>
              <label className="block"><span className={label}>کد تخفیف</span><input className={input} dir="ltr" value={builder.popup.couponCode} onChange={(e) => patch({ popup: { ...builder.popup, couponCode: e.target.value } })} /></label>
              <div className="sm:col-span-2"><span className={label}>تصویر کنار پاپ‌آپ (درگ‌اند‌دراپ)</span><ImageDropField value={builder.popup.image} onChange={(url) => patch({ popup: { ...builder.popup, image: url } })} /></div>
              <div className="sm:col-span-2"><span className={label}>تصویر پس‌زمینه کل پاپ‌آپ (اختیاری)</span><ImageDropField value={builder.popup.bgImage} onChange={(url) => patch({ popup: { ...builder.popup, bgImage: url } })} /></div>
              <label className="block sm:col-span-2"><span className={label}>تیتر</span><input className={input} value={builder.popup.title} onChange={(e) => patch({ popup: { ...builder.popup, title: e.target.value } })} /></label>
              <label className="block sm:col-span-2"><span className={label}>متن</span><textarea className="min-h-16 w-full rounded-[3px] border border-neutral-300 p-3 text-[12px]" value={builder.popup.body} onChange={(e) => patch({ popup: { ...builder.popup, body: e.target.value } })} /></label>
              <label className="block"><span className={label}>پلیسهولدر ورودی</span><input className={input} value={builder.popup.inputPlaceholder} onChange={(e) => patch({ popup: { ...builder.popup, inputPlaceholder: e.target.value } })} /></label>
              <label className="block"><span className={label}>متن دکمه</span><input className={input} value={builder.popup.ctaLabel} onChange={(e) => patch({ popup: { ...builder.popup, ctaLabel: e.target.value } })} /></label>
            </Row>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={builder.popup.oncePerSession} onChange={(e) => patch({ popup: { ...builder.popup, oncePerSession: e.target.checked } })} className="accent-[#011c3a]" />
              فقط یک بار در هر نشست نمایش داده شود
            </label>
          </div>
        </section>
      )}

      {/* ---------------- پیشنهاد استایل (ویرایشگر تصویری درگ‌اند‌دراپ) ---------------- */}
      {tab === "look" && (
        <section className={card}>
          <div className="flex items-center justify-between">
            <h3 className="text-[12.5px] font-medium">پیشنهاد استایل — ویرایشگر تصویری</h3>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={builder.look.enabled} onChange={(e) => patch({ look: { ...builder.look, enabled: e.target.checked } })} className="accent-[#011c3a]" />
              نمایش کل قسمت
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={label}>عنوان ست</span><input className={input} value={builder.look.title} onChange={(e) => patch({ look: { ...builder.look, title: e.target.value } })} /></label>
            <label className="block"><span className={label}>زیرعنوان</span><input className={input} value={builder.look.subtitle} onChange={(e) => patch({ look: { ...builder.look, subtitle: e.target.value } })} /></label>
          </div>

          <div className="mt-4">
            <VisualHotspotCanvas
              image={builder.look.image}
              hotspots={builder.look.hotspots}
              onChange={(hotspots) => patch({ look: { ...builder.look, hotspots } })}
              onImageChange={(image) => patch({ look: { ...builder.look, image } })}
            />
          </div>

          {/* محصولات لینکشده — درگ برای چینش */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-medium">محصولات لینک‌شده به ست</h4>
              <button onClick={() => patch({ look: { ...builder.look, products: [...builder.look.products, { id: `lp-${Date.now()}`, name: "محصول جدید", price: 1000000, img: "/images/flat.jpg", to: "/shop" }] } })} className={btnPrimary}>+ محصول</button>
            </div>
            <p className="mt-1 text-[10px] text-neutral-400">برای تغییر چینش، کارت را بگیر و روی جای دلخواه رها کن.</p>
            <div className="mt-3">
              <SortableList
                items={builder.look.products}
                onReorder={(products) => patch({ look: { ...builder.look, products } })}
                renderItem={(lp, i) => (
                  <div className="grid gap-2 rounded-[4px] border border-neutral-200 bg-white p-3 sm:grid-cols-[64px_1fr_130px_140px_auto] sm:items-center">
                    <span className="cursor-grab select-none text-center text-[14px] text-neutral-300" title="بکش">⠿</span>
                    <div className="flex items-center gap-2">
                      <img src={lp.img} alt="" className="h-12 w-10 rounded-[3px] object-cover" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <input className="h-8 w-full rounded-[3px] border border-neutral-300 px-2 text-[11px]" value={lp.name} placeholder="نام محصول" onChange={(e) => { const products = [...builder.look.products]; products[i] = { ...lp, name: e.target.value }; patch({ look: { ...builder.look, products } }); }} />
                        <input className="h-8 w-full rounded-[3px] border border-neutral-300 px-2 text-[11px]" dir="ltr" value={lp.to} placeholder="/product/…" onChange={(e) => { const products = [...builder.look.products]; products[i] = { ...lp, to: e.target.value }; patch({ look: { ...builder.look, products } }); }} />
                      </div>
                    </div>
                    <input type="number" className="h-8 w-full rounded-[3px] border border-neutral-300 px-2 text-[11px] num-fa" value={lp.price} placeholder="قیمت" onChange={(e) => { const products = [...builder.look.products]; products[i] = { ...lp, price: Number(e.target.value) }; patch({ look: { ...builder.look, products } }); }} />
                    <div className="scale-90 origin-right"><ImageDropField compact value={lp.img} onChange={(img) => { const products = [...builder.look.products]; products[i] = { ...lp, img }; patch({ look: { ...builder.look, products } }); }} /></div>
                    <button onClick={() => patch({ look: { ...builder.look, products: builder.look.products.filter((_, j) => j !== i) } })} className={btn}>حذف</button>
                  </div>
                )}
              />
            </div>
          </div>
        </section>
      )}

      {/* ---------------- مجله و بلاگ ---------------- */}
      {/* ---------------- کامپوننت‌ها: شمارنده جشنواره ---------------- */}
      {tab === "components" && <ComponentsEditor countdown={builder.components.countdown} onPatch={(next) => patch({ components: { countdown: next } })} />}

      {tab === "blog" && (
        <section className={card}>
          <h3 className="text-[12.5px] font-medium">مجله صفحه اصلی و بلاگ‌ساز</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <span className={label}>گرید صفحه اصلی</span>
              <div className="grid grid-cols-3 gap-1.5">
                {([["2col", "۲ ستونه"], ["3col", "موزاییک"], ["list", "لیستی"]] as const).map(([id, name]) => (
                  <button key={id} onClick={() => patch({ blog: { ...builder.blog, homeGrid: id } })} className={(builder.blog.homeGrid === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10.5px]"}>{name}</button>
                ))}
              </div>
            </div>
            <label className="block"><span className={label}>تعداد مقالات صفحه اصلی: {builder.blog.homeCount}</span>
              <input type="range" min={1} max={12} value={builder.blog.homeCount} onChange={(e) => patch({ blog: { ...builder.blog, homeCount: Number(e.target.value) } })} className="w-full accent-[#011c3a]" />
            </label>
          </div>
          <div className="mt-5 space-y-3">
            <p className="text-[11px] text-neutral-500">مقالات سفارشی (مقالات سنجاق‌شده اول می‌آیند؛ اگر خالی باشد مقالات پیش‌فرض نمایش داده می‌شوند):</p>
            {builder.blog.posts.map((post, i) => (
              <PostEditor key={post.slug + i} post={post} onChange={(next) => { const posts = [...builder.blog.posts]; posts[i] = next; patch({ blog: { ...builder.blog, posts } }); }} onRemove={() => patch({ blog: { ...builder.blog, posts: builder.blog.posts.filter((_, j) => j !== i) } })} />
            ))}
            <button onClick={() => patch({ blog: { ...builder.blog, posts: [...builder.blog.posts, { slug: `post-${Date.now()}`, title: "مقاله جدید", excerpt: "", body: "متن مقاله…\n\nپاراگراف دوم.", cover: "/images/flat.jpg", date: new Date().toISOString().slice(0, 10), category: "استایل", readTime: "4", pinned: false }] } })} className={btnPrimary}>+ مقاله جدید</button>
          </div>
        </section>
      )}

      {/* ---------------- اینستاگرام ---------------- */}
      {tab === "instagram" && (
        <section className={card}>
          <div className="flex items-center justify-between">
            <h3 className="text-[12.5px] font-medium">بخش اینستاگرام پایین صفحه اصلی</h3>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={builder.instagram.enabled} onChange={(e) => patch({ instagram: { ...builder.instagram, enabled: e.target.checked } })} className="accent-[#011c3a]" />
              نمایش
            </label>
          </div>
          <div className="mt-3 space-y-3">
            <label className="block max-w-sm"><span className={label}>آیدی اینستاگرام (کانکت)</span><input className={input} dir="ltr" value={builder.instagram.username} onChange={(e) => patch({ instagram: { ...builder.instagram, username: e.target.value } })} placeholder="kolbe.vintage" /></label>
            {builder.instagram.cards.map((c, i) => (
              <InstaCardEditor key={c.id} card={c} onChange={(next) => { const cards = [...builder.instagram.cards]; cards[i] = next; patch({ instagram: { ...builder.instagram, cards } }); }} onRemove={() => patch({ instagram: { ...builder.instagram, cards: builder.instagram.cards.filter((x) => x.id !== c.id) } })} />
            ))}
            <button onClick={() => patch({ instagram: { ...builder.instagram, cards: [...builder.instagram.cards, { id: `ic-${Date.now()}`, icon: "star", title: "کارت جدید", text: "توضیح کوتاه" }] } })} className={btn}>+ کارت جدید</button>
            <div className="mt-4 rounded-[4px] border border-dashed border-neutral-300 p-3">
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={builder.instagram.cta.enabled} onChange={(e) => patch({ instagram: { ...builder.instagram, cta: { ...builder.instagram.cta, enabled: e.target.checked } } })} className="accent-[#011c3a]" />کارت CTA فعال باشد</label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={label}>تیتر CTA</span><input className={input} value={builder.instagram.cta.title} onChange={(e) => patch({ instagram: { ...builder.instagram, cta: { ...builder.instagram.cta, title: e.target.value } } })} /></label>
                <label className="block"><span className={label}>متن</span><input className={input} value={builder.instagram.cta.text} onChange={(e) => patch({ instagram: { ...builder.instagram, cta: { ...builder.instagram.cta, text: e.target.value } } })} /></label>
                <label className="block"><span className={label}>متن دکمه</span><input className={input} value={builder.instagram.cta.buttonLabel} onChange={(e) => patch({ instagram: { ...builder.instagram, cta: { ...builder.instagram.cta, buttonLabel: e.target.value } } })} /></label>
                <label className="block"><span className={label}>لینک</span><input className={input} dir="ltr" value={builder.instagram.cta.buttonTo} onChange={(e) => patch({ instagram: { ...builder.instagram, cta: { ...builder.instagram.cta, buttonTo: e.target.value } } })} /></label>
                <label className="block"><span className={label}>رنگ پس‌زمینه</span><ColorField value={builder.instagram.cta.bg} onChange={(v) => patch({ instagram: { ...builder.instagram, cta: { ...builder.instagram.cta, bg: v } } })} /></label>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- فوتر ---------------- */}
      {tab === "footer" && (
        <section className={card}>
          <h3 className="text-[12.5px] font-medium">فوتر و خبرنامه</h3>
          <label className="mt-3 flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={builder.footer.newsletterEnabled} onChange={(e) => patch({ footer: { ...builder.footer, newsletterEnabled: e.target.checked } })} className="accent-[#011c3a]" />
            فرم ایمیل خبرنامه فعال باشد
          </label>
          <div className="mt-4 space-y-3">
            <p className="text-[11px] text-neutral-500">شبکه‌های اجتماعی / لینک‌های بالای فوتر:</p>
            {builder.footer.socials.map((soc, i) => (
              <div key={i} className="grid gap-2 rounded-[4px] border border-neutral-200 p-3 sm:grid-cols-[110px_1fr_1fr_auto]">
                <input className={input} value={soc.icon} onChange={(e) => { const socials = [...builder.footer.socials]; socials[i] = { ...soc, icon: e.target.value }; patch({ footer: { ...builder.footer, socials } }); }} placeholder="آیکون (mail/phone/star)" />
                <input className={input} value={soc.label} onChange={(e) => { const socials = [...builder.footer.socials]; socials[i] = { ...soc, label: e.target.value }; patch({ footer: { ...builder.footer, socials } }); }} placeholder="برچسب" />
                <input className={input} dir="ltr" value={soc.url} onChange={(e) => { const socials = [...builder.footer.socials]; socials[i] = { ...soc, url: e.target.value }; patch({ footer: { ...builder.footer, socials } }); }} placeholder="https://…" />
                <button onClick={() => patch({ footer: { ...builder.footer, socials: builder.footer.socials.filter((_, j) => j !== i) } })} className={btn}>حذف</button>
              </div>
            ))}
            <button onClick={() => patch({ footer: { ...builder.footer, socials: [...builder.footer.socials, { icon: "mail", label: "کانال جدید", url: "https://" }] } })} className={btn}>+ شبکه اجتماعی</button>
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------ ویرایشگرهای ردیفی ------------------------------ */

function StyleCardEditor({ card, onChange, onRemove }: { card: BuilderStyleCard; onChange: (c: BuilderStyleCard) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 rounded-[4px] border border-neutral-200 p-3 sm:grid-cols-2">
      <label className="block"><span className={label}>نام استایل</span><input className={input} value={card.name} onChange={(e) => onChange({ ...card, name: e.target.value })} /></label>
      <label className="block"><span className={label}>نام لاتین</span><input className={input} dir="ltr" value={card.latin} onChange={(e) => onChange({ ...card, latin: e.target.value })} /></label>
      <label className="block"><span className={label}>تصویر</span><ImageField value={card.img} onChange={(url) => onChange({ ...card, img: url })} /></label>
      <label className="block"><span className={label}>تعداد محصول (اختیاری)</span><input className={input} value={card.count ?? ""} onChange={(e) => onChange({ ...card, count: e.target.value })} /></label>
      <div className="sm:col-span-2"><button onClick={onRemove} className={btn}>حذف کارت</button></div>
    </div>
  );
}

function HotspotEditor({ hotspot, onChange, onRemove }: { hotspot: BuilderHotspot; onChange: (h: BuilderHotspot) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 rounded-[4px] border border-neutral-200 p-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <label className="block"><span className={label}>متن</span><input className={input} value={hotspot.label} onChange={(e) => onChange({ ...hotspot, label: e.target.value })} /></label>
      <label className="block"><span className={label}>جایگاه افقی: {hotspot.x}٪</span><input type="range" min={0} max={100} value={hotspot.x} onChange={(e) => onChange({ ...hotspot, x: Number(e.target.value) })} className="w-full accent-[#011c3a]" /></label>
      <label className="block"><span className={label}>جایگاه عمودی: {hotspot.y}٪</span><input type="range" min={0} max={100} value={hotspot.y} onChange={(e) => onChange({ ...hotspot, y: Number(e.target.value) })} className="w-full accent-[#011c3a]" /></label>
      <label className="block"><span className={label}>رنگ</span><ColorField value={hotspot.color} onChange={(v) => onChange({ ...hotspot, color: v })} /></label>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[10.5px]"><input type="checkbox" checked={hotspot.visible} onChange={(e) => onChange({ ...hotspot, visible: e.target.checked })} className="accent-[#011c3a]" />نمایش</label>
        <button onClick={onRemove} className={btn}>حذف</button>
      </div>
    </div>
  );
}

function PostEditor({ post, onChange, onRemove }: { post: BuilderPost; onChange: (p: BuilderPost) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[4px] border border-neutral-200">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 truncate text-right text-[12px] font-medium">{post.title}</button>
        <label className="flex items-center gap-1.5 text-[10.5px]"><input type="checkbox" checked={post.pinned ?? false} onChange={(e) => onChange({ ...post, pinned: e.target.checked })} className="accent-[#011c3a]" />سنجاق</label>
        <button onClick={onRemove} className={btn}>حذف</button>
      </div>
      {open && (
        <div className="grid gap-2 border-t border-neutral-200 p-3 sm:grid-cols-2">
          <label className="block"><span className={label}>عنوان</span><input className={input} value={post.title} onChange={(e) => onChange({ ...post, title: e.target.value })} /></label>
          <label className="block"><span className={label}>نامک (slug)</span><input className={input} dir="ltr" value={post.slug} onChange={(e) => onChange({ ...post, slug: e.target.value })} /></label>
          <label className="block"><span className={label}>دسته</span><input className={input} value={post.category} onChange={(e) => onChange({ ...post, category: e.target.value })} /></label>
          <label className="block"><span className={label}>تاریخ</span><input type="date" className={input} dir="ltr" value={post.date} onChange={(e) => onChange({ ...post, date: e.target.value })} /></label>
          <label className="block"><span className={label}>زمان مطالعه (دقیقه)</span><input type="number" className={input} value={post.readTime} onChange={(e) => onChange({ ...post, readTime: e.target.value })} /></label>
          <label className="block"><span className={label}>تصویر شاخص</span><ImageField value={post.cover} onChange={(url) => onChange({ ...post, cover: url })} /></label>
          <label className="block sm:col-span-2"><span className={label}>خلاصه</span><textarea className="min-h-14 w-full rounded-[3px] border border-neutral-300 p-3 text-[12px]" value={post.excerpt} onChange={(e) => onChange({ ...post, excerpt: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className={label}>متن کامل (هر پاراگراف با خط خالی جدا شود)</span><textarea className="min-h-32 w-full rounded-[3px] border border-neutral-300 p-3 text-[12px]" value={post.body} onChange={(e) => onChange({ ...post, body: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}

function InstaCardEditor({ card, onChange, onRemove }: { card: BuilderInstaCard; onChange: (c: BuilderInstaCard) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 rounded-[4px] border border-neutral-200 p-3 sm:grid-cols-[110px_1fr_2fr_auto]">
      <input className={input} value={card.icon} onChange={(e) => onChange({ ...card, icon: e.target.value })} placeholder="آیکون" />
      <input className={input} value={card.title} onChange={(e) => onChange({ ...card, title: e.target.value })} placeholder="تیتر" />
      <input className={input} value={card.text} onChange={(e) => onChange({ ...card, text: e.target.value })} placeholder="متن" />
      <button onClick={onRemove} className={btn}>حذف</button>
    </div>
  );
}


/* ------------------- کارت استایل بصری (ویرایشگر تصویری) ------------------- */

function StyleCardVisual({ card, onChange, onRemove }: { card: BuilderStyleCard; onChange: (c: BuilderStyleCard) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[6px] border border-neutral-200 bg-white">
      <div className="flex cursor-grab items-center gap-3 p-3" onClick={() => setOpen(!open)}>
        <span className="select-none text-[14px] text-neutral-300" title="بکش و جابه‌جا کن">⠿</span>
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[3px] bg-neutral-100">
          <img src={card.img} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{card.name}</p>
          <p className="truncate text-[10px] tracking-[0.15em] text-neutral-400">{card.latin.toUpperCase()}</p>
        </div>
        <span className="shrink-0 text-[10px] text-neutral-400">{open ? "بستن ▲" : "ویرایش ▼"}</span>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-neutral-200 p-3 sm:grid-cols-2">
          <label className="block"><span className={label}>نام استایل</span><input className={input} value={card.name} onChange={(e) => onChange({ ...card, name: e.target.value })} /></label>
          <label className="block"><span className={label}>نام لاتین</span><input className={input} dir="ltr" value={card.latin} onChange={(e) => onChange({ ...card, latin: e.target.value })} /></label>
          <label className="block"><span className={label}>تعداد محصول</span><input className={input} value={card.count ?? ""} onChange={(e) => onChange({ ...card, count: e.target.value })} /></label>
          <div><span className={label}>تصویر کارت (درگ‌اند‌دراپ)</span><ImageDropField compact value={card.img} onChange={(img) => onChange({ ...card, img })} /></div>
          <div className="sm:col-span-2"><button onClick={onRemove} className={btn}>حذف کارت</button></div>
        </div>
      )}
    </div>
  );
}

/* --------------------------- پیشنمایش زنده بنر --------------------------- */

function BannerPreview({ config }: { config: SiteBuilder["banner"] }) {
  return (
    <div className="relative min-h-[220px] overflow-hidden">
      {config.mediaType === "video" && config.media ? (
        <video src={config.media} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <img src={config.media} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0" style={{ background: `rgba(7,20,34,${config.overlay})` }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white">
        <p className="text-[9px] tracking-[0.35em] text-white/80">{config.eyebrow}</p>
        <h3 className="mt-2 text-[20px] font-medium">{config.title}</h3>
        <p className="mt-2 max-w-sm text-[10.5px] text-white/80">{config.description}</p>
        <button className="banner-cta mt-4 rounded-[3px] px-6 py-2.5 text-[11px] font-medium transition" style={{ background: config.buttonBg, color: config.buttonText, ["--banner-hover-bg" as string]: config.buttonHoverBg, ["--banner-hover-text" as string]: config.buttonHoverText }}>
          {config.buttonLabel}
        </button>
      </div>
    </div>
  );
}

/* --------------------- کامپوننت‌ها: شمارنده جشنواره --------------------- */

const COUNTDOWN_PLACEMENTS: Array<{ key: keyof CountdownComponent["placement"]; label: string; hint: string }> = [
  { key: "hero", label: "هیرو صفحه اصلی", hint: "روی هیرو (هر تمپلیتی)" },
  { key: "featureBanner", label: "بنر بزرگ (بنرساز)", hint: "بنر وسط صفحه اصلی" },
  { key: "midBanner", label: "بنر کالکشن", hint: "بنر بعد از جدیدترین‌ها" },
  { key: "bottomWholesale", label: "بنر خرید عمده", hint: "کاشی پایین — راست" },
  { key: "bottomStyles", label: "بنر استایل‌ها", hint: "کاشی پایین — چپ" },
];

function ComponentsEditor({ countdown, onPatch }: { countdown: CountdownComponent; onPatch: (next: CountdownComponent) => void }) {
  const set = (partial: Partial<CountdownComponent>) => onPatch({ ...countdown, ...partial });
  const setPlacement = (key: keyof CountdownComponent["placement"], value: boolean) =>
    onPatch({ ...countdown, placement: { ...countdown.placement, [key]: value } });

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[12.5px] font-medium">شمارنده جشنواره — کامپوننت قابل نصب</h3>
          <p className="mt-1 text-[10.5px] leading-relaxed text-neutral-500">
            یک بار تنظیمش کنید و روی هر بنر و حتی روی هیرو نصبش کنید؛ چند جا هم‌زمان هم نمایش داده می‌شود.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={countdown.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="accent-[#011c3a]" />
          فعال‌سازی کامپوننت
        </label>
      </div>

      {/* پیشنمایش زنده روی یک بنر شبیهسازی‌شده */}
      <div className="mt-4 overflow-hidden rounded-[6px] border border-neutral-200">
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2">
          <span className="text-[10px] font-medium text-neutral-500">پیش‌نمایش زنده</span>
          <span className="text-[9px] text-neutral-400">همان چیزی که روی سایت دیده می‌شود</span>
        </div>
        <div className="relative min-h-[210px] overflow-hidden">
          <img src="/images/banner.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/40" />
          <div className={"absolute inset-x-0 flex px-6 " + (countdown.align === "center" ? "justify-center" : countdown.align === "right" ? "justify-start" : "justify-end") + " " + (countdown.position === "top" ? "top-6" : countdown.position === "center" ? "top-1/2 -translate-y-1/2" : "bottom-6")}>
            <HeroCountdown config={countdown} size={countdown.size} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={label}>برچسب شمارنده</span><input className={input} value={countdown.label} onChange={(e) => set({ label: e.target.value })} placeholder="پایان جشنواره" /></label>
        <label className="block"><span className={label}>زمان پایان جشنواره</span><input type="datetime-local" dir="ltr" className={input} value={countdown.target} onChange={(e) => set({ target: e.target.value })} /></label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <span className={label}>استایل</span>
          <div className="grid grid-cols-2 gap-1.5">
            {([["glass", "شیشه‌ای"], ["dark", "سرمه‌ای"], ["light", "روشن"], ["solid", "تخت"]] as const).map(([id, name]) => (
              <button key={id} onClick={() => set({ style: id })} className={(countdown.style === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10px]"}>{name}</button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>اندازه</span>
          <div className="grid grid-cols-3 gap-1.5">
            {([["sm", "کوچک"], ["md", "متوسط"], ["lg", "بزرگ"]] as const).map(([id, name]) => (
              <button key={id} onClick={() => set({ size: id })} className={(countdown.size === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10px]"}>{name}</button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>رنگ تأکید</span>
          <input type="color" value={countdown.accent} onChange={(e) => set({ accent: e.target.value })} className="h-10 w-full cursor-pointer rounded-[3px] border border-neutral-300" />
        </div>
      </div>

      {/* محل نصب */}
      <div className="mt-4 rounded-[6px] border border-neutral-200 p-3">
        <p className="text-[11.5px] font-medium">محل نصب — کجاها نمایش داده شود؟</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {COUNTDOWN_PLACEMENTS.map((place) => (
            <label key={place.key} className={(countdown.placement[place.key] ? "border-[#011c3a] bg-[#f3f5f7]" : "border-neutral-200") + " flex cursor-pointer items-start gap-2.5 rounded-[6px] border p-3 transition hover:border-[#011c3a]"}>
              <input type="checkbox" checked={countdown.placement[place.key]} onChange={(e) => setPlacement(place.key, e.target.checked)} className="mt-0.5 accent-[#011c3a]" />
              <span>
                <span className="block text-[11px] font-medium">{place.label}</span>
                <span className="mt-0.5 block text-[9.5px] text-neutral-500">{place.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <span className={label}>جای عمودی روی بنر</span>
          <div className="grid grid-cols-3 gap-1.5">
            {([["top", "بالای بنر"], ["center", "وسط بنر"], ["bottom", "پایین بنر"]] as const).map(([id, name]) => (
              <button key={id} onClick={() => set({ position: id })} className={(countdown.position === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10px]"}>{name}</button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>تراز افقی</span>
          <div className="grid grid-cols-3 gap-1.5">
            {([["right", "راست"], ["center", "وسط"], ["left", "چپ"]] as const).map(([id, name]) => (
              <button key={id} onClick={() => set({ align: id })} className={(countdown.align === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300") + " h-9 rounded-[3px] border text-[10px]"}>{name}</button>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-neutral-400">
        نکته: شمارنده جدا از «استودیوی هیرو» کار می‌کند؛ اگر شمارنده هیرو فعال باشد هر دو نمایش داده می‌شوند — برای یکی بودن، شمارنده استودیوی هیرو را خاموش کنید.
      </p>
    </section>
  );
}
