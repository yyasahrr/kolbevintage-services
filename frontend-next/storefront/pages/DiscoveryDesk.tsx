import { useEffect, useState } from "react";
import {
  crawlSeo, createKolbeProduct, loadChannels, loadImportErrors, loadImports, loadRedirects, loadRobots, loadSeoHealth, loadSeoIssues,
  mapImport, quotePrice, runImport, saveChannel, saveRedirect, saveRobots, saveSeoDocument, uploadImport,
} from "../lib/discoveryApi";

const field = "mt-1 h-10 w-full border border-neutral-300 bg-white px-3 text-[11px]";
const button = "h-10 bg-[#011c3a] px-4 text-[10.5px] text-white disabled:opacity-40";

function Banner({ error, notice }: { error: string; notice: string }) {
  return <>
    {error && <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-3 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">{notice}</p>}
  </>;
}

const policyLabel: Record<string, string> = {
  disabled: "غیرفعال",
  enabled: "فعال",
  disabled_when_discounted: "غیرفعال هنگام تخفیف",
  enabled_when_discounted: "فعال حتی با تخفیف",
};

export function ChannelDesk() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "", sku: "", price: "", channel: "both", installmentPolicy: "disabled" });
  const load = () => loadChannels().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "خوانده نشد"));
  useEffect(() => { load(); }, []);
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">CHANNEL</p><h1 className="mt-1 text-[18px] font-medium">مالکیت و کانال فروش</h1><p className="mt-1 max-w-3xl text-[10.5px] leading-6 text-neutral-500">کالای تأمین‌کننده فقط عمده است. سرور حتی اگر فرم، خرده یا هر دو را بفرستد، آن را رد می‌کند. قیمت اقساط را هم سرور حساب می‌کند.</p></header>
    <Banner error={error} notice={notice} />
    <form className="mb-4 grid gap-2 border bg-white p-4 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault();
      setError("");
      try {
        await createKolbeProduct({ name: form.name, sku: form.sku, price: Number(form.price), channel: form.channel, installmentPolicy: form.installmentPolicy, retailEnabled: form.channel !== "wholesale", wholesaleEnabled: form.channel !== "retail" });
        setNotice("محصول کلبه با کانال تأییدشده ذخیره شد.");
        await load();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "ذخیره نشد"); }
    }}>
      <input aria-label="نام محصول کلبه" className={field} placeholder="نام" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <input aria-label="کد محصول کلبه" className={field} placeholder="SKU" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
      <input aria-label="قیمت نقدی" className={field} placeholder="قیمت نقدی" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
      <select aria-label="کانال فروش" className={field} value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
        <option value="retail">فقط خرده</option>
        <option value="wholesale">فقط عمده</option>
        <option value="both">هر دو</option>
      </select>
      <select aria-label="سیاست اقساط" className={field} value={form.installmentPolicy} onChange={(event) => setForm({ ...form, installmentPolicy: event.target.value })}>
        {Object.entries(policyLabel).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
      <button className={button}>ثبت محصول کلبه</button>
    </form>
    <div className="overflow-x-auto border bg-white">
      <table className="w-full text-right text-[11px]">
        <thead className="bg-neutral-50"><tr><th className="p-2">نام</th><th>مالک</th><th>خرده</th><th>عمده</th><th>اقساط</th></tr></thead>
        <tbody>
          {(data?.supplierProducts ?? []).slice(0, 30).map((product: any) => <tr key={product.id} className="border-t">
            <td className="p-2">{product.name}</td>
            <td>{product.owner_type === "supplier" ? "تأمین‌کننده" : "کلبه"}</td>
            <td>{product.retail_enabled ? "بله" : "خیر"}</td>
            <td>{product.wholesale_enabled ? "بله" : "خیر"}</td>
            <td>
              <button type="button" className="underline" onClick={() => saveChannel(product.id, { retailEnabled: true, wholesaleEnabled: true }).then(() => setNotice("اگر مالک تأمین‌کننده باشد سرور رد می‌کند.")).catch((reason) => setError(reason instanceof Error ? reason.message : "رد شد"))}>آزمایش کانال</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

export function ImportDesk() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState("products");
  const [mode, setMode] = useState("upsert");
  const refresh = () => loadImports().then((data) => setJobs(data.jobs ?? [])).catch((reason) => setError(reason instanceof Error ? reason.message : "تاریخچه خوانده نشد"));
  useEffect(() => { refresh(); }, []);
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">IMPORT</p><h1 className="mt-1 text-[18px] font-medium">مرکز ورود و مهاجرت</h1><p className="mt-1 max-w-3xl text-[10.5px] leading-6 text-neutral-500">CSV و Excel پذیرفته می‌شود. نگاشت ستون پیشنهاد می‌شود ولی تا تأیید مدیر اعمال نمی‌شود. آزمایش خشک چیزی در کاتالوگ نمی‌نویسد. رمز عبور هرگز وارد نمی‌شود.</p></header>
    <Banner error={error} notice={notice} />
    <div className="mb-4 flex flex-wrap gap-2">
      <select aria-label="نوع ورود" className={field + " max-w-[180px]"} value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="products">محصول</option>
        <option value="users">کاربر</option>
        <option value="inventory">موجودی انبار</option>
        <option value="seo">سئو</option>
      </select>
      <select aria-label="حالت ورود" className={field + " max-w-[180px]"} value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="upsert">ایجاد و به‌روزرسانی</option>
        <option value="create_only">فقط ایجاد</option>
        <option value="update_existing">فقط به‌روزرسانی</option>
      </select>
      <label className={button + " inline-flex cursor-pointer items-center"}>انتخاب فایل
        <input aria-label="فایل ورود" className="sr-only" type="file" accept=".csv,.xlsx,.xls,.zip" onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const contentBase64 = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
          try {
            const uploaded = await uploadImport({ filename: file.name, contentBase64, kind, mode });
            setDraft(uploaded);
            setNotice("فرمت تشخیص داده شد. نگاشت را تأیید کنید.");
          } catch (reason) { setError(reason instanceof Error ? reason.message : "بارگذاری نشد"); }
        }} />
      </label>
    </div>
    {draft && <div className="mb-4 border bg-white p-4 text-[11px]">
      <p>فرمت: {draft.format} · ستون‌ها: {(draft.headers ?? []).join("، ") || "—"}</p>
      <p className="mt-2">پیشنهاد: {Object.entries(draft.suggestions ?? {}).map(([field, header]) => `${field} ← ${header}`).join(" · ") || "ستونی شناخته نشد"}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={button} onClick={async () => { await mapImport(draft.id, draft.suggestions ?? {}, mode); setNotice("نگاشت تأیید شد."); }}>تأیید نگاشت</button>
        <button type="button" className={button} onClick={async () => { const report = await runImport(draft.id, true); setNotice(`آزمایش خشک: معتبر ${report.valid_count}، هشدار ${report.warning_count}، خطا ${report.error_count}`); await refresh(); }}>آزمایش خشک</button>
        <button type="button" className={button} onClick={async () => { const report = await runImport(draft.id, false); setNotice(`ورود انجام شد: ایجاد ${report.created_count ?? 0}، به‌روزرسانی ${report.updated_count ?? 0}`); await refresh(); }}>ورود</button>
      </div>
    </div>}
    <ul className="space-y-2 text-[11px]">
      {jobs.map((job) => <li key={job.id} className="border bg-white p-3">
        <p>{job.filename} · {job.kind} · {job.status} · {job.progress}٪</p>
        <p>معتبر {job.valid_count} · هشدار {job.warning_count} · خطا {job.error_count} · مدت {job.duration_ms ?? "—"} میلی‌ثانیه</p>
        <button type="button" className="mt-1 underline" onClick={() => loadImportErrors(job.id).then((data) => {
          const blob = new Blob([data.csv || ""], { type: "text/csv" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = data.filename || "errors.csv";
          link.click();
        })}>دانلود ردیف‌های ردشده</button>
      </li>)}
    </ul>
  </section>;
}

export function SeoDesk() {
  const [health, setHealth] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [robots, setRobots] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [doc, setDoc] = useState({ entityType: "landing", slug: "", seoTitle: "", metaDescription: "", h1: "", index: true });
  const [preview, setPreview] = useState<any>(null);
  useEffect(() => {
    loadSeoHealth().then(setHealth).catch(() => setError("سلامت سئو خوانده نشد."));
    loadRobots().then((data) => { setRobots(data.body || ""); setWarning(data.warning || ""); }).catch(() => undefined);
    loadSeoIssues().then((data) => setIssues(data.issues ?? [])).catch(() => undefined);
  }, []);
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">SEO</p><h1 className="mt-1 text-[18px] font-medium">کشف و سئو</h1><p className="mt-1 max-w-3xl text-[10.5px] leading-6 text-neutral-500">امتیاز پایین یک شاخص عملیاتی داخلی است، نه رتبه گوگل. قیمت و موجودی در HTML اولیه محصول می‌آید. ربات‌تکست صفحه را از ایندکس خارج نمی‌کند.</p></header>
    <Banner error={error} notice={notice} />
    {health && <div className="mb-4 grid gap-3 sm:grid-cols-4">
      <article className="border bg-white p-3"><p className="text-[10px] text-neutral-400">سلامت عملیاتی</p><p className="text-[22px]">{health.score}</p></article>
      <article className="border bg-white p-3"><p className="text-[10px] text-neutral-400">خطا</p><p>{health.errors}</p></article>
      <article className="border bg-white p-3"><p className="text-[10px] text-neutral-400">هشدار</p><p>{health.warnings}</p></article>
      <article className="border bg-white p-3"><p className="text-[10px] text-neutral-400">آستانه</p><p>LCP ≤ ۲.۵ث · INP &lt; ۲۰۰ · CLS &lt; ۰.۱</p></article>
    </div>}
    <form className="mb-4 grid gap-2 border bg-white p-4 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault();
      try {
        const saved = await saveSeoDocument(doc);
        setPreview(saved.preview);
        setNotice("سند سئو ذخیره شد. پیش‌نمایش گوگل از داده واقعی همین سند است.");
      } catch (reason) { setError(reason instanceof Error ? reason.message : "ذخیره نشد"); }
    }}>
      <input aria-label="اسلاگ" className={field} placeholder="اسلاگ" value={doc.slug} onChange={(event) => setDoc({ ...doc, slug: event.target.value })} required />
      <input aria-label="عنوان سئو" className={field} placeholder="عنوان" value={doc.seoTitle} onChange={(event) => setDoc({ ...doc, seoTitle: event.target.value })} />
      <input aria-label="توضیح متا" className={field} placeholder="توضیح متا" value={doc.metaDescription} onChange={(event) => setDoc({ ...doc, metaDescription: event.target.value })} />
      <input aria-label="H1" className={field} placeholder="H1" value={doc.h1} onChange={(event) => setDoc({ ...doc, h1: event.target.value })} />
      <button className={button}>ذخیره سند</button>
    </form>
    {preview && <p className="mb-4 border bg-white p-3 text-[11px]">پیش‌نمایش: {preview.title} — {preview.description}</p>}
    <div className="mb-4 border bg-white p-4">
      <p className="text-[12px] font-medium">robots.txt</p>
      {warning && <p className="mt-1 text-[10.5px] text-amber-800">{warning}</p>}
      <textarea aria-label="متن robots" className="mt-2 h-24 w-full border p-2 text-[11px]" value={robots} onChange={(event) => setRobots(event.target.value)} />
      <button type="button" className={`${button} mt-2`} onClick={() => saveRobots(robots).then(() => setNotice("robots ذخیره شد؛ این کار deindex نیست.")).catch((reason) => setError(reason instanceof Error ? reason.message : "ذخیره نشد"))}>ذخیره robots</button>
    </div>
    <div className="mb-4 flex gap-2">
      <button type="button" className={button} onClick={() => crawlSeo().then((report) => setNotice(`خزش: جدید ${report.added}، رفع‌شده ${report.fixed}، باقی‌مانده ${report.remaining}`)).catch((reason) => setError(reason instanceof Error ? reason.message : "خزش نشد"))}>خزش دستی</button>
      <button type="button" className={button} onClick={() => crawlSeo("daily").then(() => setNotice("زمان‌بندی روزانه ذخیره شد.")).catch((reason) => setError(reason instanceof Error ? reason.message : "زمان‌بندی نشد"))}>روزانه</button>
      <button type="button" className={button} onClick={() => saveRedirect({ source: "/old-path", target: "/shop", status: 301 }).then(() => setNotice("ریدایرکت ۳۰۱ ثبت شد.")).catch((reason) => setError(reason instanceof Error ? reason.message : "رد شد"))}>نمونه ریدایرکت</button>
    </div>
    <ul className="space-y-1 text-[11px]">{issues.slice(0, 12).map((issue) => <li key={issue.id} className="border bg-white px-3 py-2">{issue.severity} · {issue.code} · {issue.message}</li>)}</ul>
  </section>;
}

export function DiscoveryCenter({ initial = "channel" }: { initial?: "channel" | "import" | "seo" }) {
  const [tab, setTab] = useState<"channel" | "import" | "seo">(initial);
  const [quote, setQuote] = useState("");
  return <div>
    <div className="mb-4 flex gap-2 text-[11px]">
      <button type="button" className={button} onClick={() => setTab("channel")}>کانال</button>
      <button type="button" className={button} onClick={() => setTab("import")}>ورود داده</button>
      <button type="button" className={button} onClick={() => setTab("seo")}>سئو</button>
      <button type="button" className={button} onClick={() => quotePrice("shirt-linen", "installment").then((data) => setQuote(data.snapshot?.eligibility ? "اقساط مجاز است" : "اقساط طبق سیاست سرور مجاز نیست")).catch((reason) => setQuote(reason instanceof Error ? reason.message : "قیمت خوانده نشد"))}>استعلام اقساط پیراهن</button>
    </div>
    {quote && <p className="mb-3 text-[11px]">{quote}</p>}
    {tab === "channel" && <ChannelDesk />}
    {tab === "import" && <ImportDesk />}
    {tab === "seo" && <SeoDesk />}
  </div>;
}
