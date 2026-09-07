import { useState } from "react";
import type { AdminProductRecord } from "../adminProducts";
import { getProductTypeDefinition, PRODUCT_TYPES, type AttributeField, type ProductTypeId, type SizeColumn } from "../productSchemas";

const input = "h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#011c3a]";

export default function DynamicProductSpecifications({ value, onChange }: { value: AdminProductRecord; onChange: (value: AdminProductRecord) => void }) {
  const selectedId = value.admin.productTypeId;
  const type = selectedId ? getProductTypeDefinition(selectedId) : null;
  const attributes = value.admin.attributeValues ?? {};
  const [confirmType, setConfirmType] = useState<ProductTypeId | null>(null);

  const applyType = (id: ProductTypeId) => {
    const definition = getProductTypeDefinition(id);
    const sizeChart = definition.defaultSizes.map((size) => ({ size, chest: "", shoulder: "", length: "", sleeve: "" }));
    onChange({
      ...value,
      sizeChart,
      specs: { ...value.specs, productType: definition.label },
      admin: {
        ...value.admin,
        productTypeId: id,
        specTemplate: id === "bag" ? "accessory" : id,
        attributeValues: {},
      },
    });
    setConfirmType(null);
  };

  const chooseType = (id: ProductTypeId) => {
    if (selectedId && selectedId !== id && Object.values(attributes).some(Boolean)) setConfirmType(id);
    else applyType(id);
  };

  const patchAttribute = (id: string, content: string) => onChange({ ...value, admin: { ...value.admin, attributeValues: { ...attributes, [id]: content } } });
  const patchSize = (index: number, key: SizeColumn["id"], content: string) => onChange({ ...value, sizeChart: value.sizeChart.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: content } : row) });
  const addSize = () => onChange({ ...value, sizeChart: [...value.sizeChart, { size: "", chest: "", shoulder: "", length: "", sleeve: "" }] });

  return (
    <section className="space-y-6">
      <header className="border-b border-neutral-200 pb-5">
        <p className="text-[9px] font-medium tracking-[.18em] text-neutral-400">PRODUCT TYPE SCHEMA</p>
        <h2 className="mt-1 text-[15px] font-medium">نوع محصول، مشخصات را تعیین می‌کند</h2>
        <p className="mt-1 max-w-3xl text-[10px] leading-6 text-neutral-500">ابتدا نوع محصول را انتخاب کنید. فقط فیلدهای مرتبط با همان نوع نمایش داده و در صفحه محصول منتشر می‌شوند؛ مشخصات کفش دیگر هیچ وابستگی‌ای به فیلدهای لباس ندارد.</p>
      </header>

      <fieldset>
        <legend className="mb-3 text-[10px] font-medium">نوع محصول</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {PRODUCT_TYPES.map((item) => (
            <button key={item.id} type="button" onClick={() => chooseType(item.id)} className={(selectedId === item.id ? "border-[#011c3a] bg-[#f1f4f7]" : "border-neutral-200 bg-white hover:border-neutral-400") + " min-h-28 border p-3 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]"}>
              <span className="block text-[12px] font-medium">{item.label}</span>
              <span className="mt-1 block text-[9px] leading-5 text-neutral-500">{item.description}</span>
              <span className="mt-2 block text-[8.5px] text-neutral-400">{item.example}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {confirmType && <div role="alertdialog" aria-label="تایید تغییر نوع محصول" className="flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 p-3 text-[10px] text-amber-900"><span className="flex-1">با تغییر نوع محصول، مقادیر مشخصات قبلی پاک می‌شوند تا داده نامرتبط منتشر نشود.</span><button type="button" onClick={() => setConfirmType(null)} className="h-8 border border-amber-400 px-3">انصراف</button><button type="button" onClick={() => applyType(confirmType)} className="h-8 bg-amber-900 px-3 text-white">تغییر نوع و پاک‌سازی</button></div>}

      {!type ? <div className="border border-dashed border-neutral-300 bg-neutral-50 px-5 py-12 text-center"><p className="text-[12px] font-medium">نوع محصول هنوز مشخص نیست</p><p className="mt-2 text-[10px] text-neutral-500">یکی از نوع‌های بالا را انتخاب کنید تا فرم مناسب ساخته شود.</p></div> : <>
        {type.groups.map((group) => <section key={group.id} className="border-t border-neutral-200 pt-5 first:border-t-0 first:pt-0">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div><h3 className="text-[12px] font-medium">{group.title}</h3><p className="mt-1 text-[9.5px] leading-5 text-neutral-500">{group.description}</p></div>
            <div className="grid gap-3 sm:grid-cols-2">{group.fields.map((field) => <AttributeControl key={field.id} field={field} value={attributes[field.id] ?? ""} onChange={(content) => patchAttribute(field.id, content)} />)}</div>
          </div>
        </section>)}

        <section className="border-t border-neutral-200 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-[12px] font-medium">راهنمای اندازه مخصوص {type.label}</h3><p className="mt-1 text-[9.5px] text-neutral-500">ستون‌ها نیز براساس نوع محصول تغییر می‌کنند.</p></div>
            <button type="button" onClick={addSize} className="h-9 border border-neutral-300 px-3 text-[10px] transition hover:border-[#011c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]">افزودن اندازه</button>
          </div>
          <div className="mt-4 overflow-x-auto border border-neutral-200">
            <table className="w-full min-w-[520px] text-right text-[10px]">
              <thead className="bg-neutral-50"><tr>{type.sizeColumns.map((column) => <th key={column.id} className="border-b p-3 font-medium">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}<th className="border-b p-3"><span className="sr-only">عملیات</span></th></tr></thead>
              <tbody>{value.sizeChart.map((row, index) => <tr key={`${row.size}-${index}`} className="border-b last:border-0">{type.sizeColumns.map((column) => <td key={column.id} className="p-1.5"><input aria-label={`${column.label} ردیف ${index + 1}`} value={row[column.id]} onChange={(event) => patchSize(index, column.id, event.target.value)} className="h-9 w-full min-w-24 border border-neutral-200 bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" /></td>)}<td className="p-2"><button type="button" aria-label={`حذف اندازه ${row.size}`} onClick={() => onChange({ ...value, sizeChart: value.sizeChart.filter((_, rowIndex) => rowIndex !== index) })} className="text-red-700 underline">حذف</button></td></tr>)}</tbody>
            </table>
            {!value.sizeChart.length && <p className="p-8 text-center text-[10px] text-neutral-400">هنوز اندازه‌ای تعریف نشده است.</p>}
          </div>
          <label className="mt-4 block text-[10px] text-neutral-500">راهنمای انتخاب اندازه<textarea value={value.sizeAdvice} onChange={(event) => onChange({ ...value, sizeAdvice: event.target.value })} rows={3} className="mt-1 w-full border border-neutral-300 p-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" placeholder={`نکته‌های انتخاب اندازه ${type.label} را بنویسید…`} /></label>
        </section>

        <section className="border-t border-neutral-200 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[12px] font-medium">مشخصات اختصاصی</h3><p className="mt-1 text-[9.5px] text-neutral-500">فقط برای مواردی که در الگوی {type.label} وجود ندارد.</p></div><button type="button" onClick={() => onChange({ ...value, admin: { ...value.admin, customSpecs: [...value.admin.customSpecs, { id: `spec-${Date.now()}`, label: "", value: "" }] } })} className="h-9 border border-neutral-300 px-3 text-[10px] hover:border-[#011c3a]">افزودن مشخصه</button></div>
          <div className="mt-3 space-y-2">{value.admin.customSpecs.map((item) => <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label="عنوان مشخصه اختصاصی" value={item.label} onChange={(event) => onChange({ ...value, admin: { ...value.admin, customSpecs: value.admin.customSpecs.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry) } })} className={input} placeholder="عنوان" /><input aria-label="مقدار مشخصه اختصاصی" value={item.value} onChange={(event) => onChange({ ...value, admin: { ...value.admin, customSpecs: value.admin.customSpecs.map((entry) => entry.id === item.id ? { ...entry, value: event.target.value } : entry) } })} className={input} placeholder="مقدار" /><button type="button" onClick={() => onChange({ ...value, admin: { ...value.admin, customSpecs: value.admin.customSpecs.filter((entry) => entry.id !== item.id) } })} className="px-3 text-[10px] text-red-700 underline">حذف</button></div>)}</div>
        </section>
      </>}
    </section>
  );
}

function AttributeControl({ field, value, onChange }: { field: AttributeField; value: string; onChange: (value: string) => void }) {
  const label = <span className="mb-1.5 block text-[10px] text-neutral-500">{field.label}{field.required && <b className="mr-1 text-red-700">*</b>}{field.unit && <span className="mr-1 text-neutral-400">({field.unit})</span>}</span>;
  if (field.type === "select") return <label>{label}<select aria-label={field.label} value={value} onChange={(event) => onChange(event.target.value)} className={input}><option value="">انتخاب کنید</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>;
  if (field.type === "textarea") return <label className="sm:col-span-2">{label}<textarea aria-label={field.label} value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full border border-neutral-300 p-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" placeholder={field.placeholder} /></label>;
  return <label>{label}<input aria-label={field.label} type={field.type} value={value} onChange={(event) => onChange(event.target.value)} className={input} placeholder={field.placeholder} /></label>;
}
