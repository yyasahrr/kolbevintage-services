import { useRef, useState } from "react";
import { fileToOptimizedDataUrl } from "../lib/imageUpload";

/**
 * ویرایشگر تصویری هات‌اسپات — المنتور-استایل:
 * هات‌اسپاتها مستقیم روی تصویر با درگ جابهجا میشوند.
 * دراپ‌زون برای تصویر + مدیریت لیست هات‌اسپاتها.
 */
export function VisualHotspotCanvas({
  image,
  hotspots,
  imageShape = "rect",
  onChange,
  onImageChange,
}: {
  image: string;
  hotspots: Array<{ id: string; x: number; y: number; label: string; color: string; visible: boolean }>;
  imageShape?: "rect" | "rounded" | "circle";
  onChange: (next: Array<{ id: string; x: number; y: number; label: string; color: string; visible: boolean }>) => void;
  onImageChange: (url: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const moveHotspot = (id: string, clientX: number, clientY: number) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.max(0, Math.min(100, ((box.right - clientX) / box.width) * 100)); // RTL: از راست
    const y = Math.max(0, Math.min(100, ((clientY - box.top) / box.height) * 100));
    onChange(hotspots.map((h) => (h.id === id ? { ...h, x: Math.round(x), y: Math.round(y) } : h)));
  };

  const shapeCls = imageShape === "circle" ? "rounded-full aspect-square" : imageShape === "rounded" ? "rounded-[1.5rem]" : "";

  const selectedHotspot = hotspots.find((h) => h.id === selected) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* بوم تصویری */}
      <div>
        <div
          ref={canvasRef}
          className={"relative select-none overflow-hidden border-2 border-dashed bg-neutral-100 " + (dragOver ? "border-[#011c3a]" : "border-neutral-300") + " " + shapeCls}
          onMouseMove={(e) => { if (dragIdRef.current) moveHotspot(dragIdRef.current, e.clientX, e.clientY); }}
          onMouseUp={() => { dragIdRef.current = null; }}
          onMouseLeave={() => { dragIdRef.current = null; }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file?.type.startsWith("image/")) onImageChange(await fileToOptimizedDataUrl(file, 1400, 0.85));
          }}
        >
          {image ? (
            <img src={image} alt="" draggable={false} className={"w-full object-cover " + (shapeCls.includes("aspect") ? "aspect-square" : "aspect-[3/4]")} />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center text-center text-[11px] text-neutral-400">
              تصویر را اینجا رها کنید یا از پنل کنار آپلود کنید
            </div>
          )}
          {hotspots.map((h) => (
            <button
              key={h.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); dragIdRef.current = h.id; setSelected(h.id); }}
              onClick={() => setSelected(h.id)}
              className={"absolute z-10 cursor-grab touch-none transition active:cursor-grabbing " + (selected === h.id ? "scale-125" : "")}
              style={{ right: `${h.x}%`, top: `${h.y}%`, opacity: h.visible ? 1 : 0.35 }}
              title={`${h.label} — بکش و جابه‌جا کن`}
            >
              <span className="block h-5 w-5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white shadow-lg" style={{ background: h.color }}>
                {selected === h.id && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-white/80" />}
              </span>
              <span className="pointer-events-none absolute right-1/2 top-4 translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-medium text-white shadow" style={{ background: h.color }}>
                {h.label}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-neutral-400">هات‌اسپات را با ماوس بکش · تصویر جدید را از سیستم روی بوم رها کن (درگ‌اند‌دراپ)</p>
      </div>

      {/* پنل هاتاسپات انتخابشده */}
      <div className="space-y-3">
        <div className="rounded-[6px] border border-neutral-200 p-3">
          <p className="text-[11px] font-medium text-neutral-500">هاش‌اسپات‌ها ({hotspots.length})</p>
          <div className="mt-2 space-y-1">
            {hotspots.map((h) => (
              <button key={h.id} onClick={() => setSelected(h.id)} className={(selected === h.id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-200 hover:border-[#011c3a]") + " flex w-full items-center gap-2 rounded-[3px] border px-2.5 py-1.5 text-right text-[11px] transition"}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
                <span className={"shrink-0 text-[9px] " + (selected === h.id ? "text-white/60" : "text-neutral-400")}>{h.visible ? "" : "مخفی"}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => onChange([...hotspots, { id: `h-${Date.now()}`, x: 50, y: 50, label: "قطعه جدید", color: "#c9654d", visible: true }])}
            className="mt-2 h-8 w-full rounded-[3px] bg-[#011c3a] text-[10.5px] font-medium text-white transition hover:bg-[#0a2c55]"
          >
            + هات‌اسپات جدید
          </button>
        </div>

        {selectedHotspot && (
          <div className="space-y-2 rounded-[6px] border border-neutral-200 p-3">
            <p className="text-[11px] font-medium text-neutral-500">ویرایش «{selectedHotspot.label}»</p>
            <input className="h-9 w-full rounded-[3px] border border-neutral-300 px-3 text-[12px]" value={selectedHotspot.label} placeholder="متن" onChange={(e) => onChange(hotspots.map((h) => (h.id === selectedHotspot.id ? { ...h, label: e.target.value } : h)))} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-neutral-500">رنگ<span><input type="color" value={selectedHotspot.color} onChange={(e) => onChange(hotspots.map((h) => (h.id === selectedHotspot.id ? { ...h, color: e.target.value } : h)))} className="mt-1 h-9 w-full cursor-pointer rounded-[3px] border border-neutral-300" /></span></label>
              <label className="flex items-end gap-2 pb-1 text-[10.5px]">
                <input type="checkbox" checked={selectedHotspot.visible} onChange={(e) => onChange(hotspots.map((h) => (h.id === selectedHotspot.id ? { ...h, visible: e.target.checked } : h)))} className="accent-[#011c3a]" />
                نمایش داده شود
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-neutral-500">
              <span>افقی: {selectedHotspot.x}٪</span>
              <span>عمودی: {selectedHotspot.y}٪</span>
            </div>
            <button onClick={() => { onChange(hotspots.filter((h) => h.id !== selectedHotspot.id)); setSelected(null); }} className="h-8 w-full rounded-[3px] border border-red-200 text-[10.5px] text-red-600 transition hover:bg-red-50">حذف هات‌اسپات</button>
          </div>
        )}

        <div className="rounded-[6px] border border-neutral-200 p-3">
          <p className="text-[11px] font-medium text-neutral-500">تصویر</p>
          <div className="mt-2">
            <ImageDropField value={image} onChange={onImageChange} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

/** فیلد تصویر با دراپ‌زون + کلیک برای آپلود */
export function ImageDropField({ value, onChange, compact = false }: { value: string; onChange: (url: string) => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file?.type.startsWith("image/")) {
          setBusy(true);
          try { onChange(await fileToOptimizedDataUrl(file)); } finally { setBusy(false); }
        }
      }}
      className={"rounded-[4px] border-2 border-dashed p-2 text-center transition " + (dragOver ? "border-[#011c3a] bg-[#011c3a]/5" : "border-neutral-300")}
    >
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try { onChange(await fileToOptimizedDataUrl(file)); } finally { setBusy(false); }
      }} />
      {value ? (
        <div className="space-y-2">
          <img src={value} alt="" className="mx-auto max-h-24 rounded-[3px] object-contain" />
          {!compact && <input className="h-8 w-full rounded-[3px] border border-neutral-300 px-2 text-[10.5px]" dir="ltr" value={value.startsWith("data:") ? "(تصویر آپلودشده)" : value} onChange={(e) => onChange(e.target.value)} />}
        </div>
      ) : (
        <p className="py-3 text-[10.5px] text-neutral-400">تصویر را اینجا رها کن</p>
      )}
      <div className="mt-1.5 flex items-center justify-center gap-2">
        <button type="button" onClick={() => ref.current?.click()} className="h-7 rounded-[3px] border border-neutral-300 px-3 text-[10px] transition hover:border-[#011c3a]">{busy ? "…" : "انتخاب فایل"}</button>
        {value ? <button type="button" onClick={() => onChange("")} className="h-7 rounded-[3px] border border-neutral-300 px-3 text-[10px] transition hover:border-red-300 hover:text-red-600">حذف</button> : null}
      </div>
    </div>
  );
}

/** لیست مرتبشدنی با درگ‌اند‌دراپ (HTML5 DnD) */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  keyOf,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  keyOf?: (item: T, index: number) => string;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const drop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    onReorder(next);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={keyOf ? keyOf(item, index) : item.id}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
          onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
          onDrop={(e) => { e.preventDefault(); drop(index); }}
          className={"rounded-[4px] transition " + (dragIndex === index ? "opacity-40" : "") + (overIndex === index && dragIndex !== null && dragIndex !== index ? " ring-2 ring-[#011c3a] ring-offset-1" : "")}
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}
