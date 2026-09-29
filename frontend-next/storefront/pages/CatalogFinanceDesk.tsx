import { useEffect, useState } from "react";
import { api, ApiError, loadToken } from "../lib/api";

function adminApi<T = any>(path: string, init?: { method?: string; body?: unknown }) {
  const token = loadToken("admin");
  if (!token) throw new ApiError("AUTH", "ورود ادمین انجام نشده است.");
  return api<T>(path, { ...init, token });
}

const ranges = [
  ["today", "امروز"], ["hour", "ساعتی"], ["7d", "۷ روز"], ["30d", "۳۰ روز"], ["3m", "۳ ماه"],
  ["6m", "۶ ماه"], ["ytd", "امسال"], ["12m", "۱۲ ماه"], ["all", "همه"],
] as const;

const attributeTypes = ["text", "textarea", "number", "decimal", "boolean", "single_select", "multi_select", "color", "date", "measurement", "file", "image", "video", "url"];

export function CatalogFinanceDesk() {
  const [tab, setTab] = useState<"structure" | "guides" | "promotions" | "finance">("structure");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="space-y-4">
      <header>
        <p className="text-[9px] tracking-[.2em] text-neutral-400">PRODUCT STRUCTURE AND FINANCE</p>
        <h2 className="mt-1 text-[16px] font-medium">ساختار محصولات و عملیات مالی</h2>
        <p className="mt-1 text-[10px] text-neutral-500">فیلدها، راهنمای سایز، کوپن شخصی و گزارش‌ها از سرور می‌آیند. نمودار مالی عدد ساختگی ندارد.</p>
      </header>
      <div className="flex flex-wrap gap-2 text-[10px]">
        {([["structure", "ساختار محصولات"], ["guides", "راهنمای سایز"], ["promotions", "کوپن و رفتار"], ["finance", "مالی"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`h-8 border px-3 ${tab === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300"}`}>{label}</button>
        ))}
      </div>
      {error ? <p className="border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">{error}</p> : null}
      {notice ? <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] text-emerald-800">{notice}</p> : null}
      {tab === "structure" && <StructurePanel onError={setError} onNotice={setNotice} />}
      {tab === "guides" && <GuidePanel onError={setError} onNotice={setNotice} />}
      {tab === "promotions" && <PromotionPanel onError={setError} onNotice={setNotice} />}
      {tab === "finance" && <FinancePanel onError={setError} />}
    </section>
  );
}

function StructurePanel({ onError, onNotice }: { onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [attributes, setAttributes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [form, setForm] = useState({ code: "", label: "", type: "text", unit: "" });
  const reload = () => Promise.all([
    adminApi<{ attributes: any[] }>("/store/kolbe/admin/attributes"),
    adminApi<{ templates: any[] }>("/store/kolbe/admin/spec-templates"),
  ]).then(([left, right]) => { setAttributes(left.attributes); setTemplates(right.templates); }).catch((error) => onError(error instanceof ApiError ? error.code : "خطا"));
  useEffect(() => { void reload(); }, []);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="space-y-2 border border-neutral-200 p-3" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await adminApi("/store/kolbe/admin/attributes", { method: "POST", body: form });
          onNotice("ویژگی ذخیره شد و در قالب‌ها قابل استفاده است.");
          setForm({ code: "", label: "", type: "text", unit: "" });
          await reload();
        } catch (error) { onError(error instanceof ApiError ? error.code : "خطا"); }
      }}>
        <h3 className="text-[12px] font-medium">ویژگی قابل استفاده مجدد</h3>
        <input className="h-9 w-full border px-2 text-[11px]" dir="ltr" placeholder="code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
        <input className="h-9 w-full border px-2 text-[11px]" placeholder="برچسب فارسی" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
        <select className="h-9 w-full border px-2 text-[11px]" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{attributeTypes.map((type) => <option key={type}>{type}</option>)}</select>
        <input className="h-9 w-full border px-2 text-[11px]" placeholder="واحد، اگر دارد" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
        <button className="h-9 bg-[#011c3a] px-3 text-[10px] text-white">ذخیره ویژگی</button>
      </form>
      <div className="border border-neutral-200 p-3 text-[11px]">
        <h3 className="font-medium">کتابخانه ویژگی و قالب</h3>
        <ul className="mt-2 space-y-1">{attributes.map((item) => <li key={item.id}>{item.label} · {item.code} · {item.type}</li>)}</ul>
        <ul className="mt-3 space-y-1 text-neutral-500">{templates.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
        {!attributes.length ? <p className="mt-2 text-neutral-400">هنوز ویژگی‌ای ثبت نشده است.</p> : null}
      </div>
    </div>
  );
}

function GuidePanel({ onError, onNotice }: { onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [columns, setColumns] = useState("size,chest");
  const [labels, setLabels] = useState("سایز,دور سینه");
  const [guides, setGuides] = useState<any[]>([]);
  const reload = () => adminApi<{ guides: any[] }>("/store/kolbe/admin/size-guides").then((result) => setGuides(result.guides)).catch((error) => onError(error instanceof ApiError ? error.code : "خطا"));
  useEffect(() => { void reload(); }, []);
  return (
    <div className="space-y-3 border border-neutral-200 p-3">
      <h3 className="text-[12px] font-medium">راهنمای سایز با ستون‌های تعریف‌شده توسط ادمین</h3>
      <input className="h-9 w-full border px-2 text-[11px]" dir="ltr" value={columns} onChange={(event) => setColumns(event.target.value)} />
      <input className="h-9 w-full border px-2 text-[11px]" value={labels} onChange={(event) => setLabels(event.target.value)} />
      <button className="h-9 bg-[#011c3a] px-3 text-[10px] text-white" onClick={async () => {
        const codes = columns.split(",").map((item) => item.trim()).filter(Boolean);
        const names = labels.split(",");
        try {
          const result = await adminApi<{ guide: { id: string } }>("/store/kolbe/admin/size-guides", { method: "POST", body: { code: "guide_admin", name: "راهنمای ادمین", columns: codes.map((code, index) => ({ code, label: names[index] || code })), rows: [] } });
          await adminApi(`/store/kolbe/admin/size-guides/${result.guide.id}/publish`, { method: "POST", body: {} });
          onNotice("راهنما نسخه جدید گرفت و منتشر شد. محصول لینک‌شده نسخه جاری را می‌بیند.");
          await reload();
        } catch (error) { onError(error instanceof ApiError ? error.code : "خطا"); }
      }}>انتشار نسخه</button>
      <ul className="text-[11px]">{guides.map((guide) => <li key={guide.id}>{guide.name} · نسخه {guide.version} · {guide.is_current ? "جاری" : "تاریخچه"}</li>)}</ul>
    </div>
  );
}

function PromotionPanel({ onError, onNotice }: { onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [ruleId, setRuleId] = useState("");
  const [result, setResult] = useState<any>(null);
  return (
    <div className="space-y-2 border border-neutral-200 p-3 text-[11px]">
      <p>قانون در حالت پیش‌نویس ساخته می‌شود. اجرا قبل از فعال‌سازی فقط شمارش و نمونه برمی‌گرداند و کوپن نمی‌سازد.</p>
      <button className="h-9 bg-[#011c3a] px-3 text-[10px] text-white" onClick={async () => {
        try {
          const saved = await adminApi<{ rule: { id: string } }>("/store/kolbe/admin/promotions", { method: "POST", body: { name: "تولد", trigger: "birthday", status: "draft", action: { percent: 10, maxDiscount: 200000, sms: "تولدتان مبارک" }, dailyCap: 1, audienceCap: 50, cooldownDays: 300 } });
          setRuleId(saved.rule.id);
          const dry = await adminApi(`/store/kolbe/admin/promotions/${saved.rule.id}/run`, { method: "POST", body: { dryRun: true } });
          setResult(dry);
          onNotice("اجرای آزمایشی ذخیره شد. پیامک فقط برای رضایت بازاریابی در صف می‌ماند.");
        } catch (error) { onError(error instanceof ApiError ? error.code : "خطا"); }
      }}>اجرای آزمایشی تولد</button>
      {ruleId ? <p dir="ltr">rule: {ruleId}</p> : null}
      {result ? <p>تطابق: {result.matched} · نمونه: {result.sample?.length ?? 0} · صادرشده: {result.issued ?? 0}</p> : null}
    </div>
  );
}

function FinancePanel({ onError }: { onError: (value: string) => void }) {
  const [range, setRange] = useState("30d");
  const [summary, setSummary] = useState<any>(null);
  const [series, setSeries] = useState<any[]>([]);
  useEffect(() => {
    Promise.all([
      adminApi<any>(`/store/kolbe/admin/finance/summary?range=${range}`),
      adminApi<any>(`/store/kolbe/admin/finance/series?range=${range}`),
    ]).then(([left, right]) => { setSummary(left); setSeries(right.points ?? []); }).catch((error) => onError(error instanceof ApiError ? error.code : "خطا"));
  }, [range]);
  const max = Math.max(1, ...series.map((point) => Number(point.sales)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">{ranges.map(([id, label]) => <button key={id} onClick={() => setRange(id)} className={`h-7 border px-2 text-[10px] ${range === id ? "bg-[#011c3a] text-white" : ""}`}>{label}</button>)}</div>
      <div className="grid gap-2 sm:grid-cols-4 text-[11px]">
        <Metric label="فروش" value={summary?.current?.sales} />
        <Metric label="ارسال" value={summary?.current?.shipping} />
        <Metric label="کارمزد دفتر" value={summary?.current?.commission} />
        <Metric label="بازپرداخت دفتر" value={summary?.current?.refunds} />
      </div>
      <p className="text-[10px] text-neutral-500">منبع: {summary?.source ?? "—"} · دوره قبل: {summary?.previous?.sales ?? "—"} · سال قبل: {summary?.previousYear?.sales ?? "—"}</p>
      <div className="flex h-28 items-end gap-1 border border-neutral-200 p-2">
        {series.length ? series.map((point) => <div key={point.date} title={`${point.date}: ${point.sales}`} className="flex-1 bg-[#011c3a]" style={{ height: `${Math.max(4, Number(point.sales) / max * 100)}%` }} />) : <p className="text-[10px] text-neutral-400">در این بازه سفارشی برای نمودار نیست.</p>}
      </div>
      <div className="flex flex-wrap gap-2 text-[10px]">
        {(["sales", "shipping", "settlements", "ledger"] as const).flatMap((kind) => (["csv", "xlsx", "pdf"] as const).map((format) => (
          <button key={`${kind}-${format}`} className="underline" onClick={() => downloadReport(kind, format, range)}>{kind} · {format}</button>
        )))}
      </div>
    </div>
  );
}

async function downloadReport(kind: string, format: string, range: string) {
  const token = loadToken("admin");
  const response = await fetch(`/store/kolbe/admin/finance/reports/${kind}?range=${range}&format=${format}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${kind}.${format === "xlsx" ? "xlsx" : format}`;
  link.click();
  URL.revokeObjectURL(url);
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <div className="border border-neutral-200 p-2"><p className="text-neutral-400">{label}</p><p className="mt-1">{value == null ? "—" : value.toLocaleString("fa-IR")}</p></div>;
}
