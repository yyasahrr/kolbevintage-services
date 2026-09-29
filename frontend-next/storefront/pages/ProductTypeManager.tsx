import { useEffect, useMemo, useState } from "react";
import { fa } from "../utils/format";
import {
  addProductTypeSize,
  createProductType,
  loadAdminProductTypes,
  reorderProductTypeSizes,
  reorderProductTypes,
  saveSeriesTemplate,
  updateProductType,
  updateProductTypeSize,
  type CatalogProductType,
  type SeriesTemplate,
} from "../lib/productTypesApi";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";
const field = `h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] ${focus}`;

export default function ProductTypeManager() {
  const [types, setTypes] = useState<CatalogProductType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ code: "", name: "", description: "" });
  const [sizeLabel, setSizeLabel] = useState("");
  const [insertAfter, setInsertAfter] = useState("end");
  const [templateId, setTemplateId] = useState<string | "new">("new");
  const [templateDraft, setTemplateDraft] = useState({ code: "", name: "", description: "" });
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const load = () => {
    setLoading(true);
    return loadAdminProductTypes()
      .then((next) => {
        setTypes(next);
        setSelectedId((current) => current && next.some((type) => type.id === current) ? current : next[0]?.id ?? null);
        setError("");
      })
      .catch(() => setError("نوع‌های محصول از پایگاه‌داده خوانده نشد."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const selected = types.find((type) => type.id === selectedId) ?? null;
  const template = selected?.templates.find((item) => item.id === templateId) ?? null;

  useEffect(() => {
    if (!selected) return;
    const current = selected.templates.find((item) => item.id === templateId);
    if (current) {
      setTemplateDraft({ code: current.code, name: current.name, description: current.description });
      setQuantities(Object.fromEntries(selected.sizes.map((size) => [size.id, current.lines.find((line) => line.sizeId === size.id)?.quantity ?? 0])));
    } else {
      setTemplateDraft({ code: "", name: "", description: "" });
      setQuantities(Object.fromEntries(selected.sizes.map((size) => [size.id, 0])));
    }
  }, [selectedId, templateId, (selected?.sizes ?? []).map((size) => size.id).join("|"), (template?.lines ?? []).map((line) => `${line.sizeId}:${line.quantity}`).join("|")]);

  const run = async (work: () => Promise<unknown>, ok: string) => {
    setError("");
    try {
      await work();
      setNotice(ok);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ذخیره انجام نشد.");
    }
  };

  const moveType = (index: number, direction: -1 | 1) => {
    const next = [...types];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTypes(next);
    run(() => reorderProductTypes(next.map((type) => type.id)), "ترتیب نوع‌های محصول ذخیره شد.");
  };

  const moveSize = async (index: number, direction: -1 | 1) => {
    if (!selected) return;
    const ids = selected.sizes.map((size) => size.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderProductTypeSizes(selected.id, ids), "ترتیب سایزها ذخیره شد. ترتیب الفبایی اعمال نمی‌شود.");
  };

  const addSize = async () => {
    if (!selected || !sizeLabel.trim()) return;
    const position = insertAfter === "start" ? 0 : insertAfter === "end" ? undefined : selected.sizes.findIndex((size) => size.id === insertAfter) + 1;
    await run(() => addProductTypeSize(selected.id, sizeLabel.trim(), position), "سایز جدید ذخیره شد و در ویرایشگر محصول قابل انتخاب است.");
    setSizeLabel("");
  };

  const saveTemplate = async () => {
    if (!selected) return;
    const lines = selected.sizes.map((size) => ({ sizeId: size.id, quantity: Number(quantities[size.id] ?? 0) })).filter((line) => line.quantity > 0);
    if (!templateDraft.name.trim() || !lines.length) {
      setError("نام قالب و حداقل یک سایز با تعداد بیشتر از صفر لازم است.");
      return;
    }
    await run(() => saveSeriesTemplate({
      id: templateId === "new" ? undefined : templateId,
      productTypeId: selected.id,
      code: templateId === "new" ? templateDraft.code : undefined,
      name: templateDraft.name,
      description: templateDraft.description,
      lines,
    }), "قالب سری با سایزهای همین نوع محصول ذخیره شد.");
  };

  const sizePreview = useMemo(() => selected?.sizes.filter((size) => size.active).map((size) => size.label).join(" · ") ?? "", [selected]);

  return (
    <section>
      <header className="mb-5">
        <p className="text-[9px] tracking-[0.22em] text-neutral-400">PRODUCT TYPES · SIZE SYSTEM</p>
        <h1 className="mt-2 text-[20px] font-medium">قالب سایزها و نوع محصول</h1>
        <p className="mt-1.5 max-w-3xl text-[10.5px] leading-6 text-neutral-500">نوع محصول، سایز و قالب سری فقط در PostgreSQL تعریف می‌شوند. هر سایز `sort_order` دارد و فهرست‌ها بر اساس حروف الفبا مرتب نمی‌شوند.</p>
      </header>
      {loading && <p className="mb-3 text-[10.5px] text-neutral-400">در حال خواندن نوع‌های محصول…</p>}
      {error && <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-3 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">{notice}</p>}
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border border-neutral-200 bg-white">
          <header className="border-b px-4 py-3 text-[12px] font-medium">نوع‌های محصول</header>
          <div className="divide-y">
            {types.map((type, index) => (
              <div key={type.id} className={`flex items-center gap-2 px-3 py-3 ${selectedId === type.id ? "bg-[#f3f6f8]" : ""}`}>
                <button type="button" onClick={() => setSelectedId(type.id)} className={`min-w-0 flex-1 text-right ${focus}`}>
                  <b className="block text-[11.5px]">{type.name}</b>
                  <span className="text-[9px] text-neutral-400">{type.code} · {fa(type.sizes.filter((size) => size.active).length)} سایز فعال{type.active ? "" : " · غیرفعال"}</span>
                </button>
                <button type="button" aria-label={`بالا بردن ${type.name}`} onClick={() => moveType(index, -1)} className="h-7 w-7 border text-[11px]">↑</button>
                <button type="button" aria-label={`پایین بردن ${type.name}`} onClick={() => moveType(index, 1)} className="h-7 w-7 border text-[11px]">↓</button>
              </div>
            ))}
          </div>
          <form className="space-y-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); run(async () => { await createProductType({ ...draft, active: true, sortOrder: types.length }); setDraft({ code: "", name: "", description: "" }); }, "نوع محصول جدید ساخته شد."); }}>
            <input aria-label="نام نوع محصول" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="مثلاً کفش" className={field} />
            <input aria-label="کد نوع محصول" required dir="ltr" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="shoe" className={field} />
            <textarea aria-label="توضیح نوع محصول" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="توضیح کوتاه" className="w-full border px-3 py-2 text-[11px]" rows={2} />
            <button className={`h-9 w-full bg-[#011c3a] text-[10.5px] text-white ${focus}`}>افزودن نوع محصول</button>
          </form>
        </aside>
        {selected ? (
          <div className="space-y-5">
            <section className="border border-neutral-200 bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[9.5px] text-neutral-500">نام<input aria-label="ویرایش نام نوع" value={selected.name} onChange={(event) => setTypes(types.map((type) => type.id === selected.id ? { ...type, name: event.target.value } : type))} className={`${field} mt-1`} /></label>
                <label className="text-[9.5px] text-neutral-500">کد<input aria-label="ویرایش کد نوع" dir="ltr" value={selected.code} onChange={(event) => setTypes(types.map((type) => type.id === selected.id ? { ...type, code: event.target.value } : type))} className={`${field} mt-1`} /></label>
                <label className="text-[9.5px] text-neutral-500 sm:col-span-2">توضیح<textarea aria-label="ویرایش توضیح نوع" value={selected.description} onChange={(event) => setTypes(types.map((type) => type.id === selected.id ? { ...type, description: event.target.value } : type))} className="mt-1 w-full border px-3 py-2 text-[11px]" rows={2} /></label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => run(() => updateProductType(selected.id, { name: selected.name, code: selected.code, description: selected.description, active: selected.active, sortOrder: selected.sortOrder }), "نوع محصول ذخیره شد.")} className={`h-9 bg-[#011c3a] px-4 text-[10px] text-white ${focus}`}>ذخیره نوع</button>
                <button type="button" onClick={() => run(() => updateProductType(selected.id, { active: !selected.active }), selected.active ? "نوع محصول غیرفعال شد." : "نوع محصول فعال شد.")} className={`h-9 border px-4 text-[10px] ${focus}`}>{selected.active ? "غیرفعال کردن" : "فعال کردن"}</button>
              </div>
              <p className="mt-3 text-[9.5px] text-neutral-400">سایزهای فعال به ترتیب نمایش: {sizePreview || "—"}</p>
            </section>
            <section className="border border-neutral-200 bg-white p-4">
              <h2 className="text-[13px] font-medium">سایزهای {selected.name}</h2>
              <p className="mt-1 text-[9.5px] text-neutral-500">افزودن، ویرایش نام، جابه‌جایی، قراردادن بین سایزهای قبلی و غیرفعال‌کردن. سایز جدید بلافاصله برای محصولات بعدی همین نوع قابل انتخاب است.</p>
              <div className="mt-4 divide-y border-y">
                {selected.sizes.map((size, index) => (
                  <div key={size.id} className="grid items-center gap-2 py-2 sm:grid-cols-[72px_1fr_auto]">
                    <span className="text-[10px] text-neutral-400 num-fa">ترتیب {fa(index + 1)}</span>
                    <input aria-label={`نام سایز ${size.label}`} defaultValue={size.label} onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== size.label) run(() => updateProductTypeSize(size.id, { label: event.target.value.trim() }), "نام سایز ویرایش شد."); }} className={field} />
                    <div className="flex gap-1">
                      <button type="button" aria-label={`انتقال ${size.label} به بالا`} onClick={() => moveSize(index, -1)} className="h-9 w-9 border">↑</button>
                      <button type="button" aria-label={`انتقال ${size.label} به پایین`} onClick={() => moveSize(index, 1)} className="h-9 w-9 border">↓</button>
                      <button type="button" onClick={() => run(() => updateProductTypeSize(size.id, { active: !size.active }), size.active ? "سایز غیرفعال شد." : "سایز فعال شد.")} className={`h-9 border px-2 text-[9.5px] ${size.active ? "" : "bg-neutral-100 text-neutral-400"}`}>{size.active ? "فعال" : "غیرفعال"}</button>
                    </div>
                  </div>
                ))}
                {!selected.sizes.length && <p className="py-6 text-center text-[10.5px] text-neutral-400">هنوز سایزی تعریف نشده است.</p>}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="text-[9.5px] text-neutral-500">سایز جدید<input aria-label="سایز جدید" value={sizeLabel} onChange={(event) => setSizeLabel(event.target.value)} placeholder="45 یا 44.5 یا 4XL" className={`${field} mt-1 w-40`} /></label>
                <label className="text-[9.5px] text-neutral-500">جای قرارگیری
                  <select aria-label="جای قرارگیری سایز جدید" value={insertAfter} onChange={(event) => setInsertAfter(event.target.value)} className={`${field} mt-1 w-48`}>
                    <option value="start">ابتدای فهرست</option>
                    {selected.sizes.map((size) => <option key={size.id} value={size.id}>بعد از {size.label}</option>)}
                    <option value="end">انتهای فهرست</option>
                  </select>
                </label>
                <button type="button" onClick={addSize} className={`h-10 bg-[#011c3a] px-4 text-[10px] text-white ${focus}`}>+ افزودن سایز</button>
              </div>
            </section>
            <section className="border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-medium">قالب‌های سری</h2>
                  <p className="mt-1 text-[9.5px] text-neutral-500">ترکیب سری از سایزهای همین نوع محصول ساخته می‌شود. اگر سایز تازه‌ای اضافه شود، اینجا با تعداد صفر ظاهر می‌شود و می‌توان آن را وارد قالب کرد.</p>
                </div>
                <select aria-label="انتخاب قالب سری" value={templateId} onChange={(event) => setTemplateId(event.target.value)} className={`${field} w-56`}>
                  <option value="new">قالب جدید</option>
                  {selected.templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-[9.5px] text-neutral-500">نام قالب<input aria-label="نام قالب سری" value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} className={`${field} mt-1`} /></label>
                <label className="text-[9.5px] text-neutral-500">کد قالب<input aria-label="کد قالب سری" dir="ltr" disabled={templateId !== "new"} value={templateDraft.code} onChange={(event) => setTemplateDraft({ ...templateDraft, code: event.target.value })} className={`${field} mt-1 disabled:bg-neutral-100`} /></label>
                <label className="text-[9.5px] text-neutral-500">توضیح<input aria-label="توضیح قالب سری" value={templateDraft.description} onChange={(event) => setTemplateDraft({ ...templateDraft, description: event.target.value })} className={`${field} mt-1`} /></label>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                {selected.sizes.map((size) => (
                  <label key={size.id} className={`border p-2 text-[10px] ${size.active ? "" : "bg-neutral-50 text-neutral-400"}`}>
                    {size.label}{size.active ? "" : " · غیرفعال"}
                    <input aria-label={`تعداد ${size.label} در قالب`} type="number" min={0} value={quantities[size.id] ?? 0} onChange={(event) => setQuantities({ ...quantities, [size.id]: Number(event.target.value) })} className={`${field} mt-1`} />
                  </label>
                ))}
              </div>
              <button type="button" onClick={saveTemplate} className={`mt-4 h-9 bg-[#011c3a] px-4 text-[10px] text-white ${focus}`}>ذخیره قالب سری</button>
            </section>
          </div>
        ) : <p className="border border-dashed px-5 py-16 text-center text-[11px] text-neutral-400">یک نوع محصول را انتخاب کنید.</p>}
      </div>
    </section>
  );
}
