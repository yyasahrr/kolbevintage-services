import { useMemo, useRef, useState } from "react";
import type { AdminProductRecord, ProductMediaItem, ProductMediaRole } from "../adminProducts";
import { fileToOptimizedDataUrl } from "../lib/imageUpload";

const control = "h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#011c3a]";
const roleLabels: Record<ProductMediaRole, string> = { primary: "تصویر اصلی", gallery: "گالری", detail: "نمای جزئیات", size: "راهنمای اندازه" };

function readVideo(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("خواندن ویدئو ناموفق بود."));
    reader.readAsDataURL(file);
  });
}

export default function ProductMediaStudio({ value, onChange }: { value: AdminProductRecord; onChange: (value: AdminProductRecord) => void }) {
  const items = value.admin.media ?? [];
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [urlKind, setUrlKind] = useState<"image" | "video">("image");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const imageCount = useMemo(() => items.filter((item) => item.kind === "image").length, [items]);

  const commit = (nextItems: ProductMediaItem[]) => {
    let normalized = nextItems.filter((item) => item.src.trim());
    const firstImageIndex = normalized.findIndex((item) => item.kind === "image");
    if (firstImageIndex >= 0 && !normalized.some((item) => item.kind === "image" && item.role === "primary")) {
      normalized = normalized.map((item, index) => index === firstImageIndex ? { ...item, role: "primary" } : item);
    }
    const images = normalized.filter((item) => item.kind === "image").map((item) => item.src);
    const video = normalized.find((item) => item.kind === "video");
    const mainImage = Math.max(0, normalized.filter((item) => item.kind === "image").findIndex((item) => item.role === "primary"));
    onChange({
      ...value,
      images,
      video: video ? { url: video.src, poster: video.poster ?? images[0] ?? "", title: video.alt } : undefined,
      admin: { ...value.admin, media: normalized, mainImage },
    });
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setNotice(null);
    try {
      const additions: ProductMediaItem[] = [];
      for (const file of list) {
        const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
        if (!kind) throw new Error(`فرمت «${file.name}» پشتیبانی نمی‌شود.`);
        if (kind === "video" && file.size > 8_000_000) throw new Error("برای ویدئوی بزرگ‌تر از ۸ مگابایت، لینک CDN را وارد کنید.");
        const src = kind === "image" ? await fileToOptimizedDataUrl(file, 1800, 0.86) : await readVideo(file);
        additions.push({ id: `media-${Date.now()}-${additions.length}`, kind, src, alt: file.name.replace(/\.[^.]+$/, ""), role: kind === "image" && imageCount === 0 && !additions.length ? "primary" : "gallery" });
      }
      commit([...items, ...additions]);
      setSelectedId(additions[0]?.id ?? selectedId);
      setNotice({ type: "success", text: `${additions.length.toLocaleString("fa-IR")} رسانه اضافه شد.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "بارگذاری رسانه ناموفق بود." });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const patchItem = (id: string, patch: Partial<ProductMediaItem>) => {
    let next = items.map((item) => item.id === id ? { ...item, ...patch } : item);
    if (patch.role === "primary") next = next.map((item) => item.id !== id && item.kind === "image" ? { ...item, role: item.role === "primary" ? "gallery" : item.role } : item);
    commit(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const addUrl = () => {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      setNotice({ type: "error", text: "لینک رسانه باید با http یا https شروع شود." });
      return;
    }
    const item: ProductMediaItem = { id: `media-${Date.now()}`, kind: urlKind, src: clean, alt: value.name || "رسانه محصول", role: urlKind === "image" && imageCount === 0 ? "primary" : "gallery" };
    commit([...items, item]);
    setSelectedId(item.id);
    setUrl("");
    setNotice({ type: "success", text: "رسانه CDN به گالری اضافه شد." });
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <p className="text-[9px] font-medium tracking-[.18em] text-neutral-400">PRODUCT MEDIA LIBRARY</p>
          <h2 className="mt-1 text-[15px] font-medium">گالری یکپارچه محصول</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-6 text-neutral-500">تصویر و ویدئو را در یک ترتیب واقعی مدیریت کنید؛ برای هر مورد نقش، متن جایگزین، رنگ مرتبط و پوستر مستقل تعیین کنید.</p>
        </div>
        <label className="h-10 cursor-pointer bg-[#011c3a] px-4 text-[10px] leading-10 text-white transition hover:bg-[#102f50] focus-within:ring-2 focus-within:ring-[#011c3a] focus-within:ring-offset-2">
          {busy ? "در حال پردازش…" : "آپلود تصویر یا ویدئو"}
          <input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*" multiple disabled={busy} onChange={(event) => void addFiles(event.target.files ?? [])} />
        </label>
      </header>

      {notice && <p role={notice.type === "error" ? "alert" : "status"} className={(notice.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-[#b9cfbc] bg-[#f1f6f1] text-[#36563a]") + " border px-3 py-2 text-[10px]"}>{notice.text}</p>}

      <div className="grid gap-3 border border-neutral-200 bg-[#f8f8f6] p-3 sm:grid-cols-[110px_1fr_auto]">
        <label className="text-[10px] text-neutral-500">نوع لینک<select className={control + " mt-1"} value={urlKind} onChange={(event) => setUrlKind(event.target.value as "image" | "video")}><option value="image">تصویر</option><option value="video">ویدئو</option></select></label>
        <label className="text-[10px] text-neutral-500">آدرس CDN یا فایل خارجی<input className={control + " mt-1"} dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://cdn.example.com/product.webp" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addUrl(); } }} /></label>
        <button type="button" onClick={addUrl} className="mt-auto h-10 border border-[#011c3a] px-4 text-[10px] transition hover:bg-[#011c3a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]">افزودن لینک</button>
      </div>

      {!items.length ? (
        <button type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }} className="flex min-h-64 w-full flex-col items-center justify-center border border-dashed border-neutral-300 bg-neutral-50 px-6 text-center transition hover:border-[#011c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]">
          <span className="text-[13px] font-medium">فایل‌ها را اینجا رها کنید</span>
          <span className="mt-2 max-w-md text-[10px] leading-5 text-neutral-500">تصویرها بهینه می‌شوند. برای ویدئوهای حجیم از CDN استفاده کنید تا صفحه محصول سریع بماند.</span>
        </button>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item, index) => (
              <article key={item.id} className={(selected?.id === item.id ? "border-[#011c3a] ring-1 ring-[#011c3a]" : "border-neutral-200") + " group relative border bg-white p-2 transition"}>
                <button type="button" onClick={() => setSelectedId(item.id)} className="block w-full text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]">
                  <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
                    {item.kind === "image" ? <img src={item.src} alt={item.alt} className="h-full w-full object-cover" /> : item.poster ? <img src={item.poster} alt={`پوستر ${item.alt}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-neutral-500">VIDEO</div>}
                    <span className="absolute right-1.5 top-1.5 bg-white/90 px-1.5 py-1 text-[8px]">{item.kind === "image" ? "تصویر" : "ویدئو"}</span>
                  </div>
                  <p className="mt-2 truncate text-[9.5px] font-medium">{item.alt || "بدون عنوان"}</p>
                  <p className="mt-1 text-[8.5px] text-neutral-400">{roleLabels[item.role]}</p>
                </button>
                <div className="mt-2 grid grid-cols-3 border-t pt-2 text-[9px]">
                  <button type="button" aria-label="انتقال به قبل" disabled={index === 0} onClick={() => move(index, -1)} className="h-7 border-l disabled:text-neutral-300">←</button>
                  <button type="button" aria-label="انتقال به بعد" disabled={index === items.length - 1} onClick={() => move(index, 1)} className="h-7 border-l disabled:text-neutral-300">→</button>
                  <button type="button" aria-label="حذف رسانه" onClick={() => { commit(items.filter((entry) => entry.id !== item.id)); if (selectedId === item.id) setSelectedId(""); }} className="h-7 text-red-700">حذف</button>
                </div>
              </article>
            ))}
          </div>

          {selected && <aside className="h-fit border border-neutral-200 bg-[#fafaf8] p-4 xl:sticky xl:top-24">
            <p className="text-[9px] font-medium tracking-[.14em] text-neutral-400">MEDIA INSPECTOR</p>
            <h3 className="mt-1 text-[12px] font-medium">تنظیمات رسانه انتخابی</h3>
            <div className="mt-4 space-y-4">
              <label className="block text-[10px] text-neutral-500">متن جایگزین و عنوان<input className={control + " mt-1"} value={selected.alt} onChange={(event) => patchItem(selected.id, { alt: event.target.value })} placeholder="توصیف دقیق تصویر برای دسترس‌پذیری" /></label>
              <label className="block text-[10px] text-neutral-500">نقش رسانه<select className={control + " mt-1"} value={selected.role} onChange={(event) => patchItem(selected.id, { role: event.target.value as ProductMediaRole })}>{Object.entries(roleLabels).filter(([key]) => selected.kind === "image" || key !== "primary").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block text-[10px] text-neutral-500">اتصال به رنگ<select className={control + " mt-1"} value={selected.variantColour ?? ""} onChange={(event) => patchItem(selected.id, { variantColour: event.target.value })}><option value="">بدون اتصال</option>{value.colours.map((colour) => <option key={colour.name}>{colour.name}</option>)}</select></label>
              {selected.kind === "video" && <>
                <label className="block text-[10px] text-neutral-500">آدرس پوستر ویدئو<input className={control + " mt-1"} dir="ltr" value={selected.poster ?? ""} onChange={(event) => patchItem(selected.id, { poster: event.target.value })} placeholder="https://cdn.example.com/poster.webp" /></label>
                <label className="block border border-dashed border-neutral-300 bg-white p-3 text-center text-[9.5px] transition hover:border-[#011c3a]">آپلود پوستر<input className="sr-only" type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) patchItem(selected.id, { poster: await fileToOptimizedDataUrl(file, 1400, 0.84) }); }} /></label>
              </>}
              <label className="block text-[10px] text-neutral-500">آدرس منبع<input className={control + " mt-1"} dir="ltr" value={selected.src} onChange={(event) => patchItem(selected.id, { src: event.target.value })} /></label>
            </div>
          </aside>}
        </div>
      )}
    </section>
  );
}
