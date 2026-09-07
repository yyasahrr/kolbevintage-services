import { useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import Icon from "../components/Icon";
import {
  aestheticCategories,
  categoryLayoutOptions,
  contrastRatio,
  defaultCategories,
  resolveTheme,
  themeTemplates,
  type CategoryCardRatio,
  type CategoryKind,
  type CategoryLayout,
  type DesignSystemConfig,
  type SiteCategory,
  type SiteTheme,
  type ThemeTokens,
} from "../designSystem";
import { saveSiteSettings, useSiteSettings, type SiteSettings } from "../siteSettings";

const control = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-[12px] outline-none transition focus:border-[#0b2a46] focus:ring-2 focus:ring-[#0b2a46]/15";
const label = "mb-1.5 block text-[11px] font-medium text-neutral-600";

function cloneTheme(theme: SiteTheme): SiteTheme {
  return { ...theme, light: { ...theme.light }, dark: { ...theme.dark } };
}

function persist(settings: SiteSettings, patch: Partial<SiteSettings>) {
  saveSiteSettings({ ...settings, ...patch });
}

function StudioTabs({ value, onChange }: { value: "categories" | "themes"; onChange: (value: "categories" | "themes") => void }) {
  return (
    <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-100 p-1" role="tablist" aria-label="بخش‌های مرکز طراحی">
      {([['categories', 'دسته‌بندی‌ها و چیدمان'], ['themes', 'تم و سیستم رنگ']] as const).map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)} className={`rounded-lg px-4 py-2 text-[12px] transition ${value === id ? "bg-white font-medium text-[#0b2a46] shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function CategoryPreview({ items, layout, ratio, radius, showBadges }: { items: SiteCategory[]; layout: CategoryLayout; ratio: CategoryCardRatio; radius: "none" | "soft" | "round"; showBadges: boolean }) {
  const enabled = items.filter((item) => item.enabled).slice(0, 6);
  const radiusClass = radius === "round" ? "rounded-xl" : radius === "soft" ? "rounded" : "rounded-none";
  const ratioClass = ratio === "portrait" ? "aspect-[3/4]" : ratio === "square" ? "aspect-square" : "aspect-[4/3]";
  const wrapClass = layout === "rail" ? "flex gap-2 overflow-hidden" : layout === "editorial" ? "grid grid-cols-3 gap-2" : layout === "split" ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-2";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-[#f5f3ee] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-medium text-neutral-600">پیش‌نمایش زنده</span>
        <span className="rounded-full bg-white px-2 py-1 text-[9px] text-neutral-500">موبایل و دسکتاپ</span>
      </div>
      {enabled.length === 0 ? (
        <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-neutral-300 bg-white text-center text-[11px] text-neutral-500">برای نمایش پیش‌نمایش، یک دسته را فعال کنید.</div>
      ) : (
        <div className={wrapClass}>
          {enabled.map((item, index) => {
            const special = layout === "bento" && index === 0 ? "col-span-2 aspect-[2/1]" : layout === "editorial" && index === 0 ? "col-span-2 row-span-2 aspect-auto min-h-52" : layout === "split" && index < 2 ? "aspect-[4/5]" : ratioClass;
            return (
              <article key={item.id} className={`relative min-w-28 overflow-hidden bg-neutral-300 ${radiusClass} ${special} ${layout === "rail" ? "w-36 shrink-0" : ""}`}>
                <img src={item.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-black/25" />
                {showBadges && item.badge && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[8px] text-neutral-800">{item.badge}</span>}
                <div className="absolute inset-x-0 bottom-0 p-2 text-white">
                  <p className="text-[11px] font-medium">{item.label}</p>
                  <p className="text-[7px] tracking-[0.15em] text-white/75">{item.latin}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CategoryEditor({ item, onChange, onImage }: { item: SiteCategory; onChange: (patch: Partial<SiteCategory>) => void; onImage: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-3">
        <img src={item.image} alt="" className="h-16 w-14 rounded-lg object-cover" />
        <div className="min-w-0 flex-1"><h3 className="truncate text-[13px] font-medium">ویرایش «{item.label || "دسته جدید"}»</h3><p className="mt-1 text-[10px] text-neutral-500">عنوان، مقصد و تصویر کارت را تنظیم کنید.</p></div>
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-neutral-300 px-3 py-2 text-[10px] hover:border-[#0b2a46]">بارگذاری تصویر</button>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={onImage} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>عنوان فارسی</span><input className={control} value={item.label} onChange={(e) => onChange({ label: e.target.value })} /></label>
        <label><span className={label}>عنوان لاتین</span><input dir="ltr" className={control} value={item.latin} onChange={(e) => onChange({ latin: e.target.value })} /></label>
        <label><span className={label}>نوع دسته</span><select className={control} value={item.kind} onChange={(e) => onChange({ kind: e.target.value as CategoryKind })}><option value="product">محصولی</option><option value="style">استایلی</option><option value="collection">کالکشن</option></select></label>
        <label><span className={label}>نشان کوتاه</span><input className={control} value={item.badge} placeholder="مثلاً محبوب" onChange={(e) => onChange({ badge: e.target.value })} /></label>
        <label className="sm:col-span-2"><span className={label}>لینک مقصد</span><input dir="ltr" className={control} value={item.to} onChange={(e) => onChange({ to: e.target.value })} /></label>
        <label className="sm:col-span-2"><span className={label}>آدرس تصویر</span><input dir="ltr" className={control} value={item.image} onChange={(e) => onChange({ image: e.target.value })} /></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-[11px]">
        <label className="flex items-center gap-2"><input type="checkbox" checked={item.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /> نمایش در سایت</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={item.featured} onChange={(e) => onChange({ featured: e.target.checked })} /> کارت شاخص</label>
      </div>
    </div>
  );
}

function CategoryStudio({ settings }: { settings: SiteSettings }) {
  const config = settings.categories;
  const [selectedId, setSelectedId] = useState(config.items[0]?.id ?? "");
  const selected = config.items.find((item) => item.id === selectedId);
  const update = (next: typeof config) => persist(settings, { categories: next });
  const patchConfig = (patch: Partial<typeof config>) => update({ ...config, ...patch });
  const patchItem = (id: string, patch: Partial<SiteCategory>) => update({ ...config, items: config.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= config.items.length) return;
    const items = [...config.items];
    [items[index], items[target]] = [items[target], items[index]];
    update({ ...config, items });
  };
  const add = () => {
    const id = `category-${Date.now()}`;
    update({ ...config, items: [...config.items, { id, label: "دسته جدید", latin: "NEW CATEGORY", image: "/images/model-front.jpg", to: "/shop", kind: "collection", badge: "", enabled: true, featured: false }] });
    setSelectedId(id);
  };
  const installPack = (kind: "product" | "style") => {
    const source = kind === "style" ? aestheticCategories : defaultCategories;
    update({ ...config, title: kind === "style" ? "استایل خودت را پیدا کن" : "دسته‌بندی محصولات", items: source.map((item) => ({ ...item })) });
    setSelectedId(source[0]?.id ?? "");
  };
  const remove = (id: string) => {
    if (!window.confirm("این دسته از صفحه اصلی حذف شود؟")) return;
    const items = config.items.filter((item) => item.id !== id);
    update({ ...config, items });
    if (selectedId === id) setSelectedId(items[0]?.id ?? "");
  };
  const imageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    if (file.size > 2_500_000) { window.alert("حجم تصویر باید کمتر از ۲.۵ مگابایت باشد."); return; }
    const reader = new FileReader();
    reader.onload = () => patchItem(selected.id, { image: String(reader.result) });
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[15px] font-medium">ساختار بخش دسته‌بندی</h2><p className="mt-1 text-[11px] leading-5 text-neutral-500">محتوا و شکل نمایش این بخش را بدون تغییر کد مدیریت کنید.</p></div><button type="button" onClick={add} className="inline-flex items-center gap-2 rounded-lg bg-[#0b2a46] px-4 py-2.5 text-[11px] font-medium text-white"><Icon name="plus" className="h-4 w-4" />افزودن دسته</button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label><span className={label}>عنوان کوچک</span><input className={control} value={config.eyebrow} onChange={(e) => patchConfig({ eyebrow: e.target.value })} /></label>
            <label><span className={label}>عنوان اصلی</span><input className={control} value={config.title} onChange={(e) => patchConfig({ title: e.target.value })} /></label>
            <label className="sm:col-span-2"><span className={label}>توضیح کوتاه</span><input className={control} value={config.description} onChange={(e) => patchConfig({ description: e.target.value })} /></label>
          </div>
          <div className="mt-5"><span className={label}>الگوی ریسپانسیو</span><div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">{categoryLayoutOptions.map((option) => <button key={option.id} type="button" onClick={() => patchConfig({ layout: option.id })} className={`min-h-20 rounded-xl border p-3 text-right transition focus:outline-none focus:ring-2 focus:ring-[#0b2a46]/20 ${config.layout === option.id ? "border-[#0b2a46] bg-[#eef3f7]" : "border-neutral-200 hover:border-neutral-400"}`}><span className="block text-[11px] font-medium">{option.label}</span><span className="mt-1 block text-[9px] leading-4 text-neutral-500">{option.description}</span></button>)}</div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label><span className={label}>نسبت تصویر</span><select className={control} value={config.ratio} onChange={(e) => patchConfig({ ratio: e.target.value as CategoryCardRatio })}><option value="landscape">افقی</option><option value="portrait">عمودی</option><option value="square">مربع</option></select></label>
            <label><span className={label}>گوشه کارت</span><select className={control} value={config.radius} onChange={(e) => patchConfig({ radius: e.target.value as typeof config.radius })}><option value="none">بدون گردی</option><option value="soft">ملایم</option><option value="round">گرد</option></select></label>
            <label className="flex items-end"><span className="flex h-10 w-full items-center gap-2 rounded-lg border border-neutral-200 px-3 text-[11px]"><input type="checkbox" checked={config.showBadges} onChange={(e) => patchConfig({ showBadges: e.target.checked })} />نمایش نشان‌ها</span></label>
          </div>
        </div>
        <div className="space-y-3"><CategoryPreview {...config} /><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => installPack("product")} className="rounded-xl border border-neutral-200 bg-white p-3 text-right text-[10px] hover:border-[#0b2a46]"><b className="block text-[11px]">دسته‌های محصولی</b><span className="mt-1 block text-neutral-500">کت، پیراهن، بافت و…</span></button><button type="button" onClick={() => installPack("style")} className="rounded-xl border border-neutral-200 bg-white p-3 text-right text-[10px] hover:border-[#0b2a46]"><b className="block text-[11px]">دسته‌های استایلی</b><span className="mt-1 block text-neutral-500">دارک آکادمیا، وینتیج و…</span></button></div></div>
      </section>
      <section className="grid gap-4 xl:grid-cols-[.7fr_1.3fr]">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3"><div className="mb-2 flex items-center justify-between px-1"><h2 className="text-[12px] font-medium">ترتیب دسته‌ها</h2><span className="text-[9px] text-neutral-400">{config.items.length} مورد</span></div><div className="max-h-[560px] space-y-2 overflow-y-auto">{config.items.length === 0 ? <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-[11px] text-neutral-500">هنوز دسته‌ای نساخته‌اید.<button type="button" onClick={add} className="mt-3 block w-full text-[#0b2a46]">ساخت اولین دسته</button></div> : config.items.map((item, index) => <div key={item.id} className={`flex items-center gap-2 rounded-xl border p-2 transition ${selectedId === item.id ? "border-[#0b2a46] bg-[#f4f7f9]" : "border-neutral-200"}`}><button type="button" onClick={() => setSelectedId(item.id)} className="flex min-w-0 flex-1 items-center gap-2 text-right"><img src={item.image} alt="" className="h-11 w-9 rounded-md object-cover" /><span className="min-w-0"><b className="block truncate text-[11px] font-medium">{item.label}</b><small className="text-[8px] text-neutral-400">{item.kind === "style" ? "استایلی" : item.kind === "product" ? "محصولی" : "کالکشن"}</small></span></button><button type="button" onClick={() => patchItem(item.id, { enabled: !item.enabled })} className={`h-6 w-9 rounded-full p-0.5 transition ${item.enabled ? "bg-[#0b2a46]" : "bg-neutral-300"}`} aria-label={item.enabled ? "غیرفعال کردن" : "فعال کردن"}><span className={`block h-5 w-5 rounded-full bg-white transition ${item.enabled ? "mr-3" : ""}`} /></button><div className="flex flex-col"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="text-[10px] disabled:opacity-20" aria-label="انتقال به بالا">↑</button><button type="button" disabled={index === config.items.length - 1} onClick={() => move(index, 1)} className="text-[10px] disabled:opacity-20" aria-label="انتقال به پایین">↓</button></div><button type="button" onClick={() => remove(item.id)} className="text-neutral-400 hover:text-red-700" aria-label="حذف دسته"><Icon name="trash" className="h-4 w-4" /></button></div>)}</div></div>
        {selected ? <CategoryEditor item={selected} onChange={(patch) => patchItem(selected.id, patch)} onImage={imageUpload} /> : <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-neutral-300 text-[11px] text-neutral-500">یک دسته را برای ویرایش انتخاب کنید.</div>}
      </section>
    </div>
  );
}

const tokenFields: Array<{ key: keyof ThemeTokens; label: string }> = [
  { key: "background", label: "پس‌زمینه" }, { key: "surface", label: "سطح کارت" }, { key: "surfaceMuted", label: "سطح ثانویه" },
  { key: "text", label: "متن اصلی" }, { key: "muted", label: "متن کم‌رنگ" }, { key: "primary", label: "رنگ اصلی" },
  { key: "primaryText", label: "متن روی اصلی" }, { key: "accent", label: "تأکیدی" }, { key: "border", label: "خط جداکننده" }, { key: "focus", label: "فوکوس" },
];

function ThemeMiniature({ theme, mode }: { theme: SiteTheme; mode: "light" | "dark" }) {
  const t = theme[mode];
  const style = { "--p-bg": t.background, "--p-surface": t.surface, "--p-text": t.text, "--p-muted": t.muted, "--p-primary": t.primary, "--p-primary-text": t.primaryText, "--p-accent": t.accent, "--p-border": t.border } as CSSProperties;
  return <div style={style} className="overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-3 text-[var(--p-text)]"><div className="flex items-center justify-between border-b border-[var(--p-border)] pb-2"><span className="text-[9px] font-semibold">KOLBE</span><div className="flex gap-1"><i className="h-1.5 w-1.5 rounded-full bg-[var(--p-accent)]" /><i className="h-1.5 w-1.5 rounded-full bg-[var(--p-primary)]" /></div></div><div className="mt-3 grid grid-cols-[1.2fr_.8fr] gap-2"><div><div className="h-2 w-14 rounded bg-[var(--p-text)]" /><div className="mt-2 h-1.5 w-full rounded bg-[var(--p-muted)] opacity-50" /><div className="mt-1 h-1.5 w-3/4 rounded bg-[var(--p-muted)] opacity-35" /><div className="mt-3 inline-block rounded bg-[var(--p-primary)] px-2 py-1 text-[7px] text-[var(--p-primary-text)]">مشاهده</div></div><div className="min-h-16 rounded-lg bg-[var(--p-surface)] ring-1 ring-[var(--p-border)]" /></div></div>;
}

function ColorField({ field, value, onChange }: { field: { key: keyof ThemeTokens; label: string }; value: string; onChange: (value: string) => void }) {
  return <label><span className={label}>{field.label}</span><div className="flex h-10 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-2 focus-within:border-[#0b2a46] focus-within:ring-2 focus-within:ring-[#0b2a46]/15"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" /><input dir="ltr" value={value} pattern="#[0-9a-fA-F]{6}" onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[10px] outline-none" /></div></label>;
}

function ThemeEditor({ draft, mode, onMode, onDraft, onSave }: { draft: SiteTheme; mode: "light" | "dark"; onMode: (mode: "light" | "dark") => void; onDraft: (theme: SiteTheme) => void; onSave: () => void }) {
  const tokens = draft[mode];
  const ratio = contrastRatio(tokens.text, tokens.background);
  const patchToken = (key: keyof ThemeTokens, value: string) => onDraft({ ...draft, [mode]: { ...tokens, [key]: value } });
  return <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[14px] font-medium">تم‌ساز اختصاصی</h2><p className="mt-1 text-[10px] text-neutral-500">هر دو نسخه روشن و تاریک را جداگانه تنظیم کنید.</p></div><div className="flex rounded-lg bg-neutral-100 p-1"><button type="button" onClick={() => onMode("light")} className={`rounded-md px-3 py-1.5 text-[10px] ${mode === "light" ? "bg-white shadow-sm" : "text-neutral-500"}`}>روشن</button><button type="button" onClick={() => onMode("dark")} className={`rounded-md px-3 py-1.5 text-[10px] ${mode === "dark" ? "bg-[#171717] text-white" : "text-neutral-500"}`}>تاریک</button></div></div><div className="mt-4 grid gap-4 lg:grid-cols-[1fr_.8fr]"><div><div className="grid gap-3 sm:grid-cols-2"><label><span className={label}>نام تم</span><input className={control} value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} /></label><label><span className={label}>مناسبت</span><input className={control} value={draft.occasion} onChange={(e) => onDraft({ ...draft, occasion: e.target.value })} /></label><label className="sm:col-span-2"><span className={label}>توضیح</span><input className={control} value={draft.description} onChange={(e) => onDraft({ ...draft, description: e.target.value })} /></label><label><span className={label}>حال‌وهوا</span><select className={control} value={draft.atmosphere} onChange={(e) => onDraft({ ...draft, atmosphere: e.target.value as SiteTheme["atmosphere"] })}><option value="clean">تمیز</option><option value="paper">ادیتوریال</option><option value="noir">نوآر</option><option value="romantic">رمانتیک</option><option value="festive">جشن</option></select></label></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{tokenFields.map((field) => <ColorField key={field.key} field={field} value={tokens[field.key]} onChange={(value) => patchToken(field.key, value)} />)}</div></div><div className="space-y-3"><ThemeMiniature theme={draft} mode={mode} /><div className={`rounded-xl border p-3 text-[10px] ${ratio >= 4.5 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><b className="block text-[11px]">کنتراست متن: {ratio.toFixed(2)}:1</b><span>{ratio >= 4.5 ? "برای متن معمولی مناسب است." : "رنگ متن و پس‌زمینه را از هم دورتر کنید؛ هدف حداقل 4.5:1 است."}</span></div><button type="button" onClick={onSave} className="w-full rounded-lg bg-[#0b2a46] px-4 py-3 text-[11px] font-medium text-white">ذخیره و فعال‌سازی تم</button></div></div></div>;
}

function ThemeStudio({ settings }: { settings: SiteSettings }) {
  const config = settings.designSystem;
  const allThemes = useMemo(() => [...themeTemplates, ...config.customThemes], [config.customThemes]);
  const active = resolveTheme(config);
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");
  const [draft, setDraft] = useState<SiteTheme>(() => ({ ...cloneTheme(active), id: `custom-${Date.now()}`, name: `${active.name} اختصاصی`, builtIn: false }));
  const saveConfig = (next: DesignSystemConfig) => persist(settings, { designSystem: next });
  const activate = (id: string) => saveConfig({ ...config, activeThemeId: id });
  const duplicate = (theme: SiteTheme) => setDraft({ ...cloneTheme(theme), id: `custom-${Date.now()}`, name: `${theme.name} اختصاصی`, builtIn: false });
  const saveDraft = () => {
    const safeDraft = { ...draft, id: draft.id.startsWith("custom-") ? draft.id : `custom-${Date.now()}`, builtIn: false };
    const exists = config.customThemes.some((theme) => theme.id === safeDraft.id);
    saveConfig({ ...config, activeThemeId: safeDraft.id, customThemes: exists ? config.customThemes.map((theme) => theme.id === safeDraft.id ? safeDraft : theme) : [...config.customThemes, safeDraft] });
    setDraft(safeDraft);
  };
  const removeCustom = (id: string) => {
    if (!window.confirm("این تم اختصاصی حذف شود؟")) return;
    saveConfig({ ...config, activeThemeId: config.activeThemeId === id ? "heritage" : config.activeThemeId, customThemes: config.customThemes.filter((theme) => theme.id !== id) });
  };
  return <div className="space-y-5"><section className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[15px] font-medium">تمپلیت‌های آماده</h2><p className="mt-1 text-[11px] text-neutral-500">هر تم یک پالت کامل و نسخه مستقل روشن و تاریک دارد.</p></div><div className="flex rounded-lg bg-neutral-100 p-1"><button type="button" onClick={() => setPreviewMode("light")} className={`rounded-md px-3 py-1.5 text-[10px] ${previewMode === "light" ? "bg-white shadow-sm" : "text-neutral-500"}`}>پیش‌نمایش روشن</button><button type="button" onClick={() => setPreviewMode("dark")} className={`rounded-md px-3 py-1.5 text-[10px] ${previewMode === "dark" ? "bg-[#171717] text-white" : "text-neutral-500"}`}>پیش‌نمایش تاریک</button></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{allThemes.map((theme) => <article key={theme.id} className={`rounded-2xl border p-3 ${config.activeThemeId === theme.id ? "border-[#0b2a46] ring-2 ring-[#0b2a46]/10" : "border-neutral-200"}`}><ThemeMiniature theme={theme} mode={previewMode} /><div className="mt-3 flex items-start justify-between gap-2"><div><h3 className="text-[12px] font-medium">{theme.name}</h3><p className="text-[9px] text-neutral-400">{theme.occasion}</p></div>{config.activeThemeId === theme.id && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[8px] text-emerald-700">فعال</span>}</div><p className="mt-2 min-h-8 text-[9px] leading-4 text-neutral-500">{theme.description}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => activate(theme.id)} className="flex-1 rounded-lg bg-[#0b2a46] px-2 py-2 text-[9px] text-white">فعال‌سازی</button><button type="button" onClick={() => duplicate(theme)} className="rounded-lg border border-neutral-300 px-3 py-2 text-[9px]">شخصی‌سازی</button>{!theme.builtIn && <button type="button" onClick={() => removeCustom(theme.id)} className="rounded-lg border border-red-100 px-2 text-red-700" aria-label="حذف تم"><Icon name="trash" className="h-3.5 w-3.5" /></button>}</div></article>)}</div></section><section className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]"><div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"><div className="flex items-center justify-between"><div><h2 className="text-[14px] font-medium">زمان‌بندی کمپین</h2><p className="mt-1 text-[10px] text-neutral-500">تم در بازه تعیین‌شده خودکار جایگزین می‌شود.</p></div><label className={`h-7 w-12 rounded-full p-1 transition ${config.schedule.enabled ? "bg-[#0b2a46]" : "bg-neutral-300"}`}><input className="sr-only" type="checkbox" checked={config.schedule.enabled} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, enabled: e.target.checked } })} /><span className={`block h-5 w-5 rounded-full bg-white transition ${config.schedule.enabled ? "mr-5" : ""}`} /></label></div><div className="mt-5 space-y-3"><label><span className={label}>تم کمپین</span><select className={control} value={config.schedule.themeId} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, themeId: e.target.value } })}>{allThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label><label><span className={label}>شروع</span><input dir="ltr" type="datetime-local" className={control} value={config.schedule.startsAt} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, startsAt: e.target.value } })} /></label><label><span className={label}>پایان</span><input dir="ltr" type="datetime-local" className={control} value={config.schedule.endsAt} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, endsAt: e.target.value } })} /></label>{config.schedule.enabled && (!config.schedule.startsAt || !config.schedule.endsAt) && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-[9px] text-amber-800">برای اجرای خودکار، زمان شروع و پایان را کامل کنید.</p>}</div></div><ThemeEditor draft={draft} mode={previewMode} onMode={setPreviewMode} onDraft={setDraft} onSave={saveDraft} /></section></div>;
}

export default function DesignSystemStudio() {
  const settings = useSiteSettings();
  const [tab, setTab] = useState<"categories" | "themes">("categories");
  return <div className="space-y-5" dir="rtl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[9px] font-semibold tracking-[0.24em] text-[#a35f4c]">DESIGN CONTROL</p><h1 className="mt-1 text-[20px] font-medium text-[#0b2a46]">مرکز طراحی فروشگاه</h1><p className="mt-1 max-w-2xl text-[11px] leading-5 text-neutral-500">دسته‌بندی‌ها، چیدمان‌های ریسپانسیو و هویت رنگی همه بخش‌های سایت را از یک نقطه مدیریت کنید.</p></div><StudioTabs value={tab} onChange={setTab} /></header>{tab === "categories" ? <CategoryStudio settings={settings} /> : <ThemeStudio settings={settings} />}</div>;
}
