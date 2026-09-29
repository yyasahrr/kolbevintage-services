import { useState } from "react";
import type { AdminProductRecord } from "../adminProducts";
import { getProductTypeDefinition, type AttributeField, type ProductTypeId, type SizeColumn } from "../productSchemas";
import { useCatalogProductTypes } from "../lib/productTypesApi";

const input = "h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#011c3a]";

function presentationType(code: string): ProductTypeId {
  if (code === "shoe") return "shoe";
  if (code === "hat") return "hat";
  if (code === "belt") return "accessory";
  return "clothing";
}

export default function DynamicProductSpecifications({ value, onChange }: { value: AdminProductRecord; onChange: (value: AdminProductRecord) => void }) {
  const { types, error, loading } = useCatalogProductTypes();
  const selectedId = value.admin.catalogTypeId ?? "";
  const catalogType = types.find((item) => item.id === selectedId) ?? null;
  const type = catalogType ? getProductTypeDefinition(presentationType(catalogType.code)) : null;
  const attributes = value.admin.attributeValues ?? {};
  const [confirmType, setConfirmType] = useState<string | null>(null);
  const sizes = catalogType?.sizes.filter((size) => size.active) ?? [];

  const applyType = (id: string) => {
    const next = types.find((item) => item.id === id);
    if (!next) return;
    const definition = getProductTypeDefinition(presentationType(next.code));
    const sizeChart = next.sizes.filter((size) => size.active).map((size) => ({ size: size.label, chest: "", shoulder: "", length: "", sleeve: "" }));
    onChange({
      ...value,
      sizeChart,
      specs: { ...value.specs, productType: next.name },
      admin: {
        ...value.admin,
        catalogTypeId: id,
        productTypeId: definition.id,
        specTemplate: definition.id === "bag" ? "accessory" : definition.id,
        attributeValues: {},
      },
    });
    setConfirmType(null);
  };

  const chooseType = (id: string) => {
    if (selectedId && selectedId !== id && Object.values(attributes).some(Boolean)) setConfirmType(id);
    else applyType(id);
  };

  const patchAttribute = (id: string, content: string) => onChange({ ...value, admin: { ...value.admin, attributeValues: { ...attributes, [id]: content } } });
  const patchSize = (index: number, key: SizeColumn["id"], content: string) => onChange({ ...value, sizeChart: value.sizeChart.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: content } : row) });
  const unused = sizes.filter((size) => !value.sizeChart.some((row) => row.size === size.label));
  const addSize = () => {
    const next = unused[0];
    if (!next) return;
    onChange({ ...value, sizeChart: [...value.sizeChart, { size: next.label, chest: "", shoulder: "", length: "", sleeve: "" }] });
  };

  return (
    <section className="space-y-6">
      <header className="border-b border-neutral-200 pb-5">
        <p className="text-[9px] font-medium tracking-[.18em] text-neutral-400">PRODUCT TYPE · SIZES</p>
        <h2 className="mt-1 text-[15px] font-medium">نوع محصول و سایزها از سرور</h2>
        <p className="mt-1 max-w-3xl text-[10px] leading-6 text-neutral-500">انتخاب نوع محصول، سایزهای فعال همان نوع را به ترتیب تعریف‌شده بارگذاری می‌کند. فهرست سایز در فرانت ثابت نیست و سایز تازه‌ای که مدیر اضافه کند همین‌جا دیده می‌شود.</p>
      </header>
      {loading && <p className="text-[10px] text-neutral-400">در حال خواندن نوع‌های محصول…</p>}
      {error && <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">{error}</p>}

      <fieldset>
        <legend className="mb-3 text-[10px] font-medium">نوع محصول</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {types.map((item) => (
            <button key={item.id} type="button" onClick={() => chooseType(item.id)} className={(selectedId === item.id ? "border-[#011c3a] bg-[#f1f4f7]" : "border-neutral-200 bg-white hover:border-neutral-400") + " min-h-28 border p-3 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]"}>
              <span className="block text-[12px] font-medium">{item.name}</span>
              <span className="mt-1 block text-[9px] leading-5 text-neutral-500">{item.description || item.code}</span>
              <span className="mt-2 block text-[8.5px] text-neutral-400">{item.sizes.filter((size) => size.active).map((size) => size.label).join(" · ") || "بدون سایز فعال"}</span>
            </button>
          ))}
        </div>
        {!types.length && !loading && <p className="text-[10px] text-neutral-400">نوع محصولی در پایگاه‌داده نیست.</p>}
      </fieldset>

      {confirmType && <div role="alertdialog" aria-label="تایید تغییر نوع محصول" className="flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 p-3 text-[10px] text-amber-900"><span className="flex-1">با تغییر نوع محصول، مقادیر مشخصات قبلی پاک و سایزهای نوع جدید جایگزین می‌شوند.</span><button type="button" onClick={() => setConfirmType(null)} className="h-8 border border-amber-400 px-3">انصراف</button><button type="button" onClick={() => applyType(confirmType)} className="h-8 bg-amber-900 px-3 text-white">تغییر نوع و پاک‌سازی</button></div>}

      {!catalogType || !type ? <div className="border border-dashed border-neutral-300 bg-neutral-50 px-5 py-12 text-center"><p className="text-[12px] font-medium">نوع محصول هنوز مشخص نیست</p><p className="mt-2 text-[10px] text-neutral-500">یکی از نوع‌های پایگاه‌داده را انتخاب کنید تا سایزها و فرم مناسب ساخته شود.</p></div> : <>
        {type.groups.map((group) => <section key={group.id} className="border-t border-neutral-200 pt-5 first:border-t-0 first:pt-0">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div><h3 className="text-[12px] font-medium">{group.title}</h3><p className="mt-1 text-[9.5px] leading-5 text-neutral-500">{group.description}</p></div>
            <div className="grid gap-3 sm:grid-cols-2">{group.fields.map((field) => <AttributeControl key={field.id} field={field} value={attributes[field.id] ?? ""} onChange={(content) => patchAttribute(field.id, content)} />)}</div>
          </div>
        </section>)}

        <section className="border-t border-neutral-200 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-[12px] font-medium">سایزهای {catalogType.name}</h3><p className="mt-1 text-[9.5px] text-neutral-500">ترتیب همان `sort_order` سرور است، نه ترتیب الفبایی.</p></div>
            <button type="button" disabled={!unused.length} onClick={addSize} className="h-9 border border-neutral-300 px-3 text-[10px] transition hover:border-[#011c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] disabled:opacity-40">افزودن سایز بعدی</button>
          </div>
          <div className="mt-4 overflow-x-auto border border-neutral-200">
            <table className="w-full min-w-[520px] text-right text-[10px]">
              <thead className="bg-neutral-50"><tr>{type.sizeColumns.map((column) => <th key={column.id} className="border-b p-3 font-medium">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}<th className="border-b p-3"><span className="sr-only">عملیات</span></th></tr></thead>
              <tbody>{value.sizeChart.map((row, index) => <tr key={`${row.size}-${index}`} className="border-b last:border-0">{type.sizeColumns.map((column) => <td key={column.id} className="p-1.5">{column.id === "size" ? <select aria-label={`سایز ردیف ${index + 1}`} value={row.size} onChange={(event) => patchSize(index, "size", event.target.value)} className="h-9 w-full min-w-24 border border-neutral-200 bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]">{sizes.map((size) => <option key={size.id} value={size.label}>{size.label}</option>)}{!sizes.some((size) => size.label === row.size) && row.size ? <option value={row.size}>{row.size}</option> : null}</select> : <input aria-label={`${column.label} ردیف ${index + 1}`} value={row[column.id]} onChange={(event) => patchSize(index, column.id, event.target.value)} className="h-9 w-full min-w-24 border border-neutral-200 bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" />}</td>)}<td className="p-2"><button type="button" aria-label={`حذف اندازه ${row.size}`} onClick={() => onChange({ ...value, sizeChart: value.sizeChart.filter((_, rowIndex) => rowIndex !== index) })} className="text-red-700 underline">حذف</button></td></tr>)}</tbody>
            </table>
            {!value.sizeChart.length && <p className="p-8 text-center text-[10px] text-neutral-400">هنوز اندازه‌ای از این نوع محصول انتخاب نشده است.</p>}
          </div>
          <label className="mt-4 block text-[10px] text-neutral-500">راهنمای انتخاب اندازه<textarea value={value.sizeAdvice} onChange={(event) => onChange({ ...value, sizeAdvice: event.target.value })} rows={3} className="mt-1 w-full border border-neutral-300 p-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" placeholder={`نکته‌های انتخاب اندازه ${catalogType.name} را بنویسید…`} /></label>
        </section>

        <section className="border-t border-neutral-200 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[12px] font-medium">مشخصات اختصاصی</h3><p className="mt-1 text-[9.5px] text-neutral-500">فقط برای مواردی که در الگوی نمایشی وجود ندارد.</p></div><button type="button" onClick={() => onChange({ ...value, admin: { ...value.admin, customSpecs: [...value.admin.customSpecs, { id: `spec-${Date.now()}`, label: "", value: "" }] } })} className="h-9 border border-neutral-300 px-3 text-[10px] hover:border-[#011c3a]">افزودن مشخصه</button></div>
          <div className="mt-3 space-y-2">{value.admin.customSpecs.map((item) => <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label="عنوان مشخصه اختصاصی" value={item.label} onChange={(event) => onChange({ ...value, admin: { ...value.admin, customSpecs: value.admin.customSpecs.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry) } })} className={input} placeholder="عنوان" /><input aria-label="مقدار مشخصه اختصاصی" value={item.value} onChange={(event) => onChange({ ...value, admin: { ...value.admin, customSpecs: value.admin.customSpecs.map((entry) => entry.id === item.id ? { ...entry, value: event.target.value } : entry) } })} className={input} placeholder="مقدار" /><button type="button" onClick={() => onChange({ ...value, admin: { ...value.admin, customSpecs: value.admin.customSpecs.filter((entry) => entry.id !== item.id) } })} className="px-3 text-[10px] text-red-700 underline">حذف</button></div>)}</div>
        </section>
      </>}
    </section>
  );
}

function AttributeControl({ field, value, onChange }: { field: AttributeField; value: string; onChange: (value: string) => void }) {
  if (field.type === "select") return <label className="text-[10px] text-neutral-500">{field.label}{field.required ? " *" : ""}<select aria-label={field.label} value={value} onChange={(event) => onChange(event.target.value)} className={`${input} mt-1`}><option value="">انتخاب کنید</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>;
  if (field.type === "textarea") return <label className="text-[10px] text-neutral-500 sm:col-span-2">{field.label}<textarea aria-label={field.label} value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-1 w-full border border-neutral-300 p-3 text-[11px]" placeholder={field.placeholder} /></label>;
  return <label className="text-[10px] text-neutral-500">{field.label}{field.required ? " *" : ""}<input aria-label={field.label} value={value} onChange={(event) => onChange(event.target.value)} className={`${input} mt-1`} placeholder={field.placeholder} /></label>;
}
