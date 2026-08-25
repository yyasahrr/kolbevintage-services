import { useRef, useState } from "react";
import { useSiteSettings, saveSiteSettings, defaultHeroStudio, type HeroStudioConfig } from "../siteSettings";
import { HERO_TEMPLATES, HeroStudioRenderer } from "../components/heroTemplates";

const input =
  "h-10 w-full rounded-[3px] border border-neutral-300 bg-white px-3 text-[12px] outline-none transition focus:border-[#011c3a]";

/** فایل تصویر را برای ذخیرهسازی localStorage بهینه میکند (حداکثر 1920px، JPEG). */
async function fileToOptimizedDataUrl(file: File, maxSize = 1920, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode-failed"));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  if (scale === 1 && dataUrl.length < 900_000) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export default function HeroStudio() {
  const settings = useSiteSettings();
  const [config, setConfig] = useState<HeroStudioConfig>(settings.heroStudio);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const timerFileRef = useRef<HTMLInputElement>(null);

  const patch = (partial: Partial<HeroStudioConfig>) => setConfig((current) => ({ ...current, ...partial }));
  const patchCountdown = (partial: Partial<HeroStudioConfig["countdown"]>) =>
    setConfig((current) => ({ ...current, countdown: { ...current.countdown, ...partial } }));

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const publish = () => {
    saveSiteSettings({ ...settings, heroStudio: { ...config, published: true } });
    flash("هیرو منتشر شد؛ صفحه اصلی همین حالا تمپلیت شما را نشان می‌دهد.");
  };

  const unpublish = () => {
    saveSiteSettings({ ...settings, heroStudio: { ...config, published: false } });
    flash("انتشار لغو شد؛ هیروی پیش‌فرض بازگشت.");
  };

  const resetAll = () => {
    setConfig(defaultHeroStudio);
    flash("به تنظیمات اولیه برگشتید (هنوز منتشر نشده).");
  };

  const handleUpload = async (file: File | undefined, apply: (dataUrl: string) => void) => {
    if (!file) return;
    setBusy(true);
    try {
      apply(await fileToOptimizedDataUrl(file));
    } catch {
      flash("خواندن تصویر انجام نشد؛ فایل دیگری امتحان کنید.");
    } finally {
      setBusy(false);
    }
  };

  const label = "mb-1.5 block text-[10.5px] font-medium text-neutral-500";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-medium">استودیوی هیرو و جشنواره</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            تمپلیت را انتخاب کن، تصویر و متن‌ها را دلخواه خودت کن و شمارنده جشنواره را تنظیم و منتشر کن. پیش‌نمایش زنده است.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={resetAll} className="h-10 rounded-[3px] border border-neutral-300 px-4 text-[11.5px] transition hover:border-[#011c3a]">بازنشانی</button>
          <button onClick={unpublish} className="h-10 rounded-[3px] border border-neutral-300 px-4 text-[11.5px] transition hover:border-[#011c3a]">لغو انتشار</button>
          <button onClick={publish} className="h-10 rounded-[3px] bg-[#011c3a] px-6 text-[11.5px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px">انتشار روی سایت</button>
        </div>
      </div>

      {notice ? <p role="status" className="rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-800">{notice}</p> : null}
      {settings.heroStudio.published ? (
        <p className="rounded-[3px] border border-sky-200 bg-sky-50 px-3 py-2.5 text-[11px] text-sky-800">تمپلیت «{HERO_TEMPLATES.find((t) => t.id === settings.heroStudio.template)?.name}» الان روی صفحه اصلی منتشر است.</p>
      ) : null}

      {/* پیشنمایش زنده */}
      <div className="overflow-hidden rounded-[6px] border border-neutral-200">
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
          <span className="text-[10.5px] font-medium text-neutral-500">پیش‌نمایش زنده — {HERO_TEMPLATES.find((t) => t.id === config.template)?.name}</span>
          <span className="text-[9.5px] text-neutral-400">{busy ? "در حال پردازش تصویر…" : "خودکار بهروز میشود"}</span>
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          <HeroStudioRenderer config={config} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* تمپلیت */}
        <section className="rounded-[6px] border border-neutral-200 p-4">
          <h3 className="text-[12.5px] font-medium">۱. تمپلیت</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {HERO_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => patch({ template: template.id })}
                className={
                  "rounded-[4px] border p-3 text-right transition " +
                  (config.template === template.id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]")
                }
              >
                <span className="block text-[11px] font-medium">{template.name}</span>
                <span className={"mt-1 block text-[9.5px] leading-relaxed " + (config.template === template.id ? "text-white/70" : "text-neutral-500")}>{template.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* پسزمینه */}
        <section className="rounded-[6px] border border-neutral-200 p-4">
          <h3 className="text-[12.5px] font-medium">۲. تصویر پس‌زمینه</h3>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className={label}>آدرس تصویر (URL)</span>
              <input className={input} dir="ltr" value={config.bgImage.startsWith("data:") ? "(تصویر آپلودشده)" : config.bgImage} onChange={(e) => patch({ bgImage: e.target.value })} placeholder="/images/hero.jpg یا https://…" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], (url) => patch({ bgImage: url }))} />
              <button type="button" onClick={() => bgFileRef.current?.click()} className="h-10 rounded-[3px] border border-neutral-300 px-4 text-[11.5px] transition hover:border-[#011c3a]">آپلود از سیستم</button>
              <span className="text-[10px] text-neutral-400">بهینه‌سازی خودکار برای وب</span>
            </div>
            <label className="block">
              <span className={label}>تیرگی پوشش: {Math.round(config.overlay * 100)}٪</span>
              <input type="range" min={0} max={85} value={Math.round(config.overlay * 100)} onChange={(e) => patch({ overlay: Number(e.target.value) / 100 })} className="w-full accent-[#011c3a]" />
            </label>
          </div>
        </section>

        {/* متنها */}
        <section className="rounded-[6px] border border-neutral-200 p-4">
          <h3 className="text-[12.5px] font-medium">۳. متن‌ها و دکمه</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className={label}>بالانویس</span><input className={input} value={config.eyebrow} onChange={(e) => patch({ eyebrow: e.target.value })} /></label>
            <label className="block sm:col-span-2"><span className={label}>تیتر</span><input className={input} value={config.title} onChange={(e) => patch({ title: e.target.value })} /></label>
            <label className="block sm:col-span-2"><span className={label}>زیرتیتر / توضیح</span><textarea className="min-h-20 w-full rounded-[3px] border border-neutral-300 p-3 text-[12px] outline-none focus:border-[#011c3a]" value={config.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} /></label>
            <label className="block"><span className={label}>متن دکمه</span><input className={input} value={config.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} /></label>
            <label className="block"><span className={label}>لینک دکمه</span><input className={input} dir="ltr" value={config.ctaTo} onChange={(e) => patch({ ctaTo: e.target.value })} placeholder="/shop" /></label>
          </div>
        </section>

        {/* شمارنده */}
        <section className="rounded-[6px] border border-neutral-200 p-4">
          <h3 className="text-[12.5px] font-medium">۴. شمارنده جشنواره</h3>
          <label className="mt-3 flex items-center gap-2 text-[11.5px]">
            <input type="checkbox" checked={config.countdown.enabled} onChange={(e) => patchCountdown({ enabled: e.target.checked })} className="accent-[#011c3a]" />
            نمایش شمارنده معکوس در هیرو
          </label>
          {config.countdown.enabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={label}>برچسب شمارنده</span><input className={input} value={config.countdown.label} onChange={(e) => patchCountdown({ label: e.target.value })} /></label>
              <label className="block">
                <span className={label}>زمان پایان جشنواره</span>
                <input type="datetime-local" className={input} dir="ltr" value={config.countdown.target} onChange={(e) => patchCountdown({ target: e.target.value })} />
              </label>
              <div className="sm:col-span-2">
                <span className={label}>استایل شمارنده</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {([["glass", "شیشه‌ای"], ["dark", "سرمه‌ای"], ["light", "روشن"], ["solid", "تخت رنگی"]] as const).map(([id, name]) => (
                    <button key={id} type="button" onClick={() => patchCountdown({ style: id })} className={(config.countdown.style === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 hover:border-[#011c3a]") + " h-9 rounded-[3px] border text-[10.5px] transition"}>{name}</button>
                  ))}
                </div>
              </div>
              <label className="block"><span className={label}>رنگ تأکید / دکمه</span><input type="color" value={config.countdown.accent} onChange={(e) => patchCountdown({ accent: e.target.value })} className="h-10 w-full cursor-pointer rounded-[3px] border border-neutral-300" /></label>
              <label className="block"><span className={label}>رنگ پس‌زمینه شمارنده (اختیاری)</span><input type="color" value={config.countdown.bgColor || "#011c3a"} onChange={(e) => patchCountdown({ bgColor: e.target.value })} className="h-10 w-full cursor-pointer rounded-[3px] border border-neutral-300" /></label>
              <label className="block sm:col-span-2"><span className={label}>تصویر پس‌زمینه شمارنده (اختیاری)</span><input className={input} dir="ltr" value={config.countdown.bgImage.startsWith("data:") ? "(تصویر آپلودشده)" : config.countdown.bgImage} onChange={(e) => patchCountdown({ bgImage: e.target.value })} placeholder="خالی = بدون تصویر" /></label>
              <div className="sm:col-span-2">
                <input ref={timerFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], (url) => patchCountdown({ bgImage: url }))} />
                <button type="button" onClick={() => timerFileRef.current?.click()} className="h-10 rounded-[3px] border border-neutral-300 px-4 text-[11.5px] transition hover:border-[#011c3a]">آپلود تصویر پس‌زمینه شمارنده</button>
              </div>
            </div>
          )}
        </section>
      </div>

      <p className="text-[10px] leading-relaxed text-neutral-400">
        ذخیرهسازی فعلاً محلی (مرورگر همین دستگاه) است؛ مطابق رودمپ، در فاز بعد به بک‌اند منتقل می‌شود تا برای همه بازدیدکنندگان اعمال شود.
      </p>
    </div>
  );
}
