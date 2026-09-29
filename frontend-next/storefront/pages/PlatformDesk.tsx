import { useEffect, useState } from "react";
import { api, loadToken } from "../lib/api";
import { listSuppliers, type AdminSupplier } from "../lib/wholesaleApi";
import {
  addBuyerAddress, addBuyerDocument, addSupplierDocument, assignCrmLabel, createCrmCampaign, evaluateCrm, issueDocument,
  loadAutomations, loadBuyer360, loadBuyers, loadCrmLabels, loadIntegrations, loadInvoiceTemplates, loadInvoices,
  loadSupplier360, money, openInvoicePdf, refundMembership, saveAutomation, saveIntegration, saveInvoiceTemplate,
  setBuyerRestriction, setCommission, setInvoiceStatus, updateBuyer, updateSupplierProfile, updateSupplierRestriction,
  updateSupplierStatus, verifySandboxPayment,
} from "../lib/platformApi";

const field = "mt-1 h-10 w-full border border-neutral-300 bg-white px-3 text-[11px]";
const button = "h-10 bg-[#011c3a] px-4 text-[10.5px] text-white disabled:opacity-40";

function metricText(label: unknown, value: unknown) {
  if (value === null || value === undefined) return "ثبت نشده";
  if (typeof value === "number" && value <= 1 && String(label).includes("نرخ")) return `${Math.round(value * 100)}٪`;
  return String(value);
}

function SupplierMoneyPath({ supplierId }: { supplierId: string }) {
  const [statement, setStatement] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  useEffect(() => {
    const token = loadToken("admin");
    if (!token) return;
    api<any>(`/store/kolbe/admin/finance/suppliers/${supplierId}/statement`, { token }).then(setStatement).catch(() => setStatement(null));
    api<any>(`/store/kolbe/admin/finance/aging?supplierId=${supplierId}`, { token }).then(setAging).catch(() => setAging(null));
  }, [supplierId]);
  const buckets = aging?.buckets ?? {};
  return <section className="border bg-white p-4 text-[11px]">
    <h2 className="text-[13px] font-medium">مسیر پول تا تسویه</h2>
    <p className="mt-1 text-[10px] text-neutral-500">مانده از خطوط دفتر دوطرفه ساخته می‌شود، نه از یک عدد ذخیره‌شده جدا.</p>
    <p className="mt-2">مانده دفتر: {statement ? Number(statement.balance).toLocaleString("fa-IR") : "—"} · منبع: {statement?.source ?? "journal"}</p>
    <div className="mt-2 grid gap-1 sm:grid-cols-6 text-[10px]">
      {[["سررسیدنشده", buckets.notDue], ["۱ تا ۷", buckets.d1_7], ["۸ تا ۳۰", buckets.d8_30], ["۳۱ تا ۶۰", buckets.d31_60], ["۶۱ تا ۹۰", buckets.d61_90], ["بیش از ۹۰", buckets.d90]].map(([label, value]) => <div key={String(label)} className="border p-2"><p className="text-neutral-400">{label}</p><b>{Number(value ?? 0).toLocaleString("fa-IR")}</b></div>)}
    </div>
    <div className="mt-2 max-h-40 overflow-y-auto">{(statement?.lines ?? []).slice(-8).map((line: any) => <p key={`${line.source_id}-${line.account_code}`}>{line.memo} · بدهکار {Number(line.debit).toLocaleString("fa-IR")} · بستانکار {Number(line.credit).toLocaleString("fa-IR")} · مانده {Number(line.balance).toLocaleString("fa-IR")}</p>)}</div>
    {!statement?.lines?.length ? <p className="mt-2 text-neutral-400">هنوز خط دفتری برای این تأمین‌کننده ثبت نشده است.</p> : null}
  </section>;
}

function RecordList({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => string }) {
  return <section className="border bg-white p-4 text-[10.5px]"><h2 className="text-[13px] font-medium">{title}</h2><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{(rows ?? []).map((row, index) => <p key={row.id ?? index}>{render(row)}</p>)}{!(rows ?? []).length && <p className="text-neutral-400">موردی ثبت نشده است.</p>}</div></section>;
}

function Banner({ error, notice }: { error: string; notice: string }) {
  return <>
    {error && <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-3 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">{notice}</p>}
  </>;
}

export function Supplier360Desk() {
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([]);
  const [id, setId] = useState("");
  const [file, setFile] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("active");
  const [until, setUntil] = useState("");
  useEffect(() => { listSuppliers().then((items) => { setSuppliers(items); setId(items[0]?.id ?? ""); }).catch(() => setError("فهرست تأمین‌کنندگان خوانده نشد.")); }, []);
  const open = (next = id) => loadSupplier360(next).then(setFile).catch((reason) => setError(reason instanceof Error ? reason.message : "پرونده خوانده نشد."));
  useEffect(() => { if (id) open(id); }, [id]);
  const run = async (work: () => Promise<unknown>, ok: string) => {
    setError("");
    try { await work(); setNotice(ok); await open(); } catch (reason) { setError(reason instanceof Error ? reason.message : "ذخیره نشد."); }
  };
  const supplier = file?.supplier;
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">SUPPLIER 360</p><h1 className="mt-1 text-[18px] font-medium">پرونده ۳۶۰ درجه تأمین‌کننده</h1><p className="mt-1 max-w-3xl text-[10.5px] leading-6 text-neutral-500">هویت، وضعیت همکاری، محدودیت‌های جزئی، مالی، عملکرد، مدارک و خط زمانی از PostgreSQL می‌آیند. غیرفعال کردن دکمه کافی نیست؛ محدودیت روی سرور اعمال می‌شود.</p></header>
    <Banner error={error} notice={notice} />
    <label className="mb-4 block max-w-sm text-[10px] text-neutral-500">تأمین‌کننده<select aria-label="انتخاب تأمین‌کننده" value={id} onChange={(event) => setId(event.target.value)} className={field}>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    {supplier && <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-3 border border-neutral-200 bg-white p-4 text-[11px]">
        <h2 className="text-[14px] font-medium">{supplier.display_name}</h2>
        <p>{supplier.legal_name} · {supplier.city || "—"}</p>
        <p>مسئول: {supplier.responsibleName || "—"} · {supplier.phone || "—"}</p>
        <p>شروع همکاری: {supplier.started_at ? new Date(supplier.started_at).toLocaleDateString("fa-IR") : supplier.created_at ? new Date(supplier.created_at).toLocaleDateString("fa-IR") : "—"}</p>
        <p>وضعیت: {supplier.cooperationLabel} · احراز: {supplier.verification_status} · نسخه پرونده: {supplier.profile_version}</p>
        <p className="num-fa">موجودی: {file.inventory?.onHand ?? 0} · رزرو: {file.inventory?.reserved ?? 0} · سابقه: {file.tenureDays ?? 0} روز</p>
        <p>نوع همکاری: {supplier.cooperation_type} · کارمزد: {supplier.commission_rate}٪</p>
        <button type="button" className={`${button} mt-2`} onClick={() => run(() => setCommission(supplier.id, 10, reason || "تغییر کارمزد"), "کارمزد روی سرور ذخیره شد.")}>کارمزد ۱۰ درصد</button>
        <form className="space-y-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); run(() => updateSupplierProfile(supplier.id, { displayName: supplier.display_name, legalName: supplier.legal_name, responsibleName: supplier.responsible_name, phone: supplier.phone, email: supplier.email, city: supplier.city, address: supplier.address, reason: "ویرایش پرونده" }), "نسخه جدید پرونده ذخیره شد."); }}>
          <input aria-label="نام مسئول" value={supplier.responsible_name || ""} onChange={(event) => setFile({ ...file, supplier: { ...supplier, responsible_name: event.target.value } })} className={field} placeholder="شخص مسئول" />
          <input aria-label="ایمیل تأمین‌کننده" value={supplier.email || ""} onChange={(event) => setFile({ ...file, supplier: { ...supplier, email: event.target.value } })} className={field} placeholder="ایمیل" />
          <input aria-label="آدرس تأمین‌کننده" value={supplier.address || ""} onChange={(event) => setFile({ ...file, supplier: { ...supplier, address: event.target.value } })} className={field} placeholder="آدرس" />
          <button className={button}>ذخیره پرونده</button>
        </form>
      </aside>
      <div className="space-y-4">
        <section className="border border-neutral-200 bg-white p-4">
          <h2 className="text-[13px] font-medium">وضعیت همکاری</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select aria-label="وضعیت همکاری" value={status} onChange={(event) => setStatus(event.target.value)} className={field}>{(file.statusCatalog ?? []).map((item: any) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
            <input aria-label="مدت محدودیت" type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} className={field} />
            <input aria-label="دلیل تغییر وضعیت" required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="دلیل" className={field} />
            <input aria-label="توضیح مدیر" value={note} onChange={(event) => setNote(event.target.value)} placeholder="توضیح مدیر" className={field} />
          </div>
          <button type="button" className={`${button} mt-3`} onClick={() => run(() => updateSupplierStatus(supplier.id, { status, reason, note, until: until || undefined }), "وضعیت، دلیل و ممیزی ذخیره شد.")}>ثبت وضعیت</button>
        </section>
        <section className="border border-neutral-200 bg-white p-4">
          <h2 className="text-[13px] font-medium">محدودیت جزئی</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{(file.restrictionCatalog ?? []).map((item: any) => {
            const current = (file.restrictions ?? []).find((entry: any) => entry.code === item.code && entry.active);
            return <button key={item.code} type="button" onClick={() => run(() => updateSupplierRestriction(supplier.id, { code: item.code, active: !current, reason: reason || "اعمال محدودیت عملیاتی", note, limit: item.code.endsWith("cap") ? 1 : undefined }), current ? "محدودیت برداشته شد." : "محدودیت روی سرور فعال شد.")} className={`border px-3 py-2 text-right text-[10.5px] ${current ? "border-red-300 bg-red-50" : "border-neutral-200"}`}>{item.label}{current ? " · فعال" : ""}</button>;
          })}</div>
        </section>
        <section className="grid gap-2 sm:grid-cols-3">{[["فروش کل", file.finance?.salesTotal], ["فروش این ماه", file.finance?.salesMonth], ["فروش این هفته", file.finance?.salesWeek], ["قابل تسویه", file.finance?.payable], ["در انتظار تسویه", file.finance?.pendingSettlement], ["تسویه‌شده", file.finance?.settled], ["کارمزد کلبه", file.finance?.fees], ["بدهی", file.finance?.debt], ["بستانکاری", file.finance?.credit], ["بلوکه‌شده", file.finance?.held], ["بازپرداخت", file.finance?.refunds], ["برداشت", file.finance?.withdrawals]].map(([label, value]) => <article key={String(label)} className="border border-neutral-200 bg-white p-3"><p className="text-[9px] text-neutral-400">{label}</p><p className="mt-1 text-[12px] font-medium num-fa">{money(Number(value || 0))}</p></article>)}</section>
        <section className="grid gap-2 sm:grid-cols-4 text-[11px]">{[["سفارش‌ها", file.performance?.ordersTotal], ["تکمیل‌شده", file.performance?.ordersCompleted], ["لغوشده", file.performance?.ordersCancelled], ["میانگین تأیید (ساعت)", file.performance?.avgConfirmHours], ["میانگین آماده‌سازی (ساعت)", file.performance?.avgPrepHours], ["تأخیر ارسال", file.performance?.lateShipments], ["نرخ مرجوعی", file.performance?.returnRate], ["نرخ لغو", file.performance?.cancelRate], ["محصول ردشده", file.performance?.rejectedProducts], ["نرخ تأیید محصول", file.performance?.approvalRate], ["تیکت", file.performance?.tickets], ["نقض SLA", file.performance?.slaViolations], ["امتیاز مشتری", file.performance?.customerScore]].map(([label, value]) => <article key={String(label)} className="border bg-white p-3"><p className="text-[9px] text-neutral-400">{label}</p><b className="num-fa">{metricText(label, value)}</b></article>)}</section>
        <section className="border bg-white p-4"><h2 className="text-[13px] font-medium">خط زمانی</h2><div className="mt-2 max-h-64 space-y-2 overflow-y-auto text-[10.5px]">{(file.timeline ?? []).map((item: any, index: number) => <div key={`${item.created_at}-${index}`} className="border-b py-2"><b>{item.title}</b><span className="mr-2 text-neutral-400">{item.source} · {item.created_at ? new Date(item.created_at).toLocaleString("fa-IR") : ""}</span><p className="text-neutral-500">{item.body}</p></div>)}</div></section>
        <SupplierMoneyPath supplierId={supplier.id} />
        <section className="border bg-white p-4"><h2 className="text-[13px] font-medium">مدارک، دفتر و پیوندهای مالی</h2><p className="mt-1 text-[10px] text-neutral-500">اعداد بالا از دفتر سرور آمده‌اند. جزئیات همین پرونده است، نه محاسبه جدا در صفحه.</p><button type="button" className={`${button} mt-2`} onClick={() => run(() => addSupplierDocument(supplier.id, { title: "مدرک همکاری", status: "pending", note }), "مدرک در پرونده ثبت شد.")}>ثبت مدرک</button><button type="button" className="mr-2 h-10 border px-3 text-[10px]" onClick={() => run(() => issueDocument({ kind: "supplier_statement", supplierId: supplier.id }), "صورت‌حساب تأمین‌کننده صادر شد.")}>صورت‌حساب</button><div className="mt-3 text-[10.5px]">{(file.documents ?? []).map((doc: any) => <p key={doc.id}>{doc.title} · {doc.status}</p>)}{(file.ledger ?? []).slice(0, 6).map((entry: any) => <p key={entry.id} className="num-fa">{entry.kind} · {money(Number(entry.amount))} · {entry.memo}</p>)}</div></section>
        <div className="grid gap-3 lg:grid-cols-2">
          <RecordList title="محصولات" rows={file.products ?? []} render={(row) => `${row.name} · ${row.sku} · ${row.status}`} />
          <RecordList title="سفارش‌ها" rows={file.orders ?? []} render={(row) => `${row.order_code} · ${row.status} · ${money(Number(row.total_amount))}`} />
          <RecordList title="برداشت و تسویه" rows={file.withdrawals ?? []} render={(row) => `${row.status} · ${money(Number(row.amount))}`} />
          <RecordList title="فاکتورها" rows={file.invoices ?? []} render={(row) => `${row.number} · ${row.kind} · ${row.status}`} />
          <RecordList title="تیکت‌ها" rows={file.tickets ?? []} render={(row) => `${row.subject} · ${row.status}`} />
          <RecordList title="تخلفات و تغییر وضعیت" rows={file.violations ?? []} render={(row) => `${row.to_status} · ${row.reason}`} />
          <RecordList title="نسخه‌های قبلی پرونده" rows={file.revisions ?? []} render={(row) => `نسخه ${row.version}`} />
        </div>
      </div>
    </div>}
  </section>;
}

export function Buyer360Desk() {
  const [buyers, setBuyers] = useState<any[]>([]);
  const [id, setId] = useState("");
  const [file, setFile] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { loadBuyers().then((items) => { setBuyers(items); setId(items[0]?.id ?? ""); }).catch(() => setError("خریداران خوانده نشدند.")); }, []);
  useEffect(() => { if (id) loadBuyer360(id).then(setFile).catch((reason) => setError(reason instanceof Error ? reason.message : "پرونده خوانده نشد.")); }, [id]);
  const run = async (work: () => Promise<unknown>, ok: string) => { setError(""); try { await work(); setNotice(ok); setFile(await loadBuyer360(id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "ذخیره نشد."); } };
  const account = file?.account;
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">BUYER 360</p><h1 className="mt-1 text-[18px] font-medium">پرونده خریدار عمده و VIP</h1><p className="mt-1 text-[10.5px] text-neutral-500">خرید عادی فقط با تأیید درگاه فعال می‌شود. تغییر مدیریتی پلن جداگانه و قابل ممیزی است.</p></header>
    <Banner error={error} notice={notice} />
    <select aria-label="انتخاب خریدار" value={id} onChange={(event) => setId(event.target.value)} className={`${field} mb-4 max-w-sm`}>{buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.store_name} · {buyer.plan_name}</option>)}</select>
    {account && <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border bg-white p-4 text-[11px]"><h2 className="text-[14px] font-medium">{account.store_name}</h2><p>{account.member_name} · {account.user_email}</p><p>{account.phone} · {account.city}</p><p>پلن: {account.plan_name} ({account.plan_code})</p><p>وضعیت: {account.status}</p><p>انقضا: {account.expires_at ? new Date(account.expires_at).toLocaleDateString("fa-IR") : "—"}</p><p className="num-fa">سقف اعتبار: {money(Number(account.credit_limit || 0))}</p><p>شناسه صنفی: {account.guild_id || "—"} · فعالیت: {account.activity_type || "—"}</p><textarea aria-label="یادداشت داخلی" defaultValue={account.internal_note || ""} onBlur={(event) => run(() => updateBuyer(account.id, "note", { note: event.target.value }), "یادداشت داخلی ذخیره شد.")} className="mt-2 w-full border p-2 text-[11px]" rows={3} /></aside>
      <div className="space-y-4">
        <section className="border bg-white p-4"><input aria-label="دلیل اقدام مدیریتی" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="دلیل اقدام مدیریتی" className={field} /><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => run(() => updateBuyer(account.id, "status", { status: "suspended", reason }), "عضویت تعلیق شد.")}>تعلیق</button><button type="button" className={button} onClick={() => run(() => updateBuyer(account.id, "status", { status: "approved", reason }), "عضویت دوباره فعال شد.")}>فعال‌سازی</button><button type="button" className="h-10 border border-red-200 px-3 text-[10px] text-red-700" onClick={() => run(() => updateBuyer(account.id, "status", { status: "blocked", reason }), "حساب مسدود شد.")}>مسدودسازی</button>{(file.plans ?? []).map((plan: any) => <button key={plan.code} type="button" className="h-10 border px-3 text-[10px]" onClick={() => run(() => updateBuyer(account.id, "plan", { planCode: plan.code, reason }), "تغییر مدیریتی پلن ثبت شد.")}>{plan.name}</button>)}<button type="button" className="h-10 border px-3 text-[10px]" onClick={() => run(() => updateBuyer(account.id, "credit", { creditLimit: 50_000_000, reason }), "سقف اعتبار ذخیره شد.")}>سقف ۵۰ میلیون</button></div>{(file.payments ?? []).filter((payment: any) => payment.status === "pending").map((payment: any) => <button key={payment.id} type="button" className={`${button} mt-3`} onClick={() => run(() => verifySandboxPayment(payment.id), "تأیید درگاه آزمایشی از سرور انجام شد. صفحه موفقیت مشتری این کار را نمی‌کند.")}>تأیید درگاه برای {payment.plan_code}</button>)}{(file.payments ?? []).filter((payment: any) => payment.status === "confirmed").slice(0, 1).map((payment: any) => <button key={payment.id} type="button" className="mt-3 h-10 border border-red-200 px-3 text-[10px] text-red-700" onClick={() => run(() => refundMembership(payment.id, reason || "بازگشت وجه"), "بازگشت وجه فقط از سرور ثبت شد و عضویت تعلیق شد.")}>بازگشت وجه آخرین پرداخت</button>)}<div className="mt-3 flex flex-wrap gap-2">{(file.restrictionCatalog ?? []).map((item: any) => <button key={item.code} type="button" className="h-10 border px-3 text-[10px]" onClick={() => run(() => setBuyerRestriction(account.id, { code: item.code, active: true, reason: reason || "محدودیت مدیریتی" }), "محدودیت خریدار روی سرور اعمال شد.")}>{item.label}</button>)}<button type="button" className="h-10 border px-3 text-[10px]" onClick={() => run(() => updateBuyer(account.id, "status", { status: "cancelled", reason: reason || "لغو عضویت" }), "عضویت لغو شد.")}>لغو عضویت</button><button type="button" className="h-10 border px-3 text-[10px]" onClick={() => run(() => addBuyerAddress(account.id, { city: account.city || "تهران", line: account.address || "آدرس ثبت‌شده" }), "آدرس در پرونده ذخیره شد.")}>ثبت آدرس</button><button type="button" className="h-10 border px-3 text-[10px]" onClick={() => run(() => addBuyerDocument(account.id, { title: "مدرک صنفی", note: reason }), "مدرک خریدار ثبت شد.")}>ثبت مدرک</button></div></section>
        <section className="grid gap-2 sm:grid-cols-4 text-[11px]">{[["سفارش عمده", file.stats?.orders], ["خرید خرده", file.retailCount], ["مجموع خرید", money(Number(file.stats?.spend || 0))], ["میانگین", money(Number(file.stats?.average || 0))], ["بدهی", money(Number(file.finance?.debt || 0))], ["اعتبار", money(Number(file.finance?.credit || 0))], ["پرداخت ناموفق", (file.paymentFailures ?? []).length], ["لغو", (file.cancels ?? []).length], ["سابقه فعالیت (روز)", file.tenureDays], ["آخرین خرید", file.stats?.last_order ? new Date(file.stats.last_order).toLocaleDateString("fa-IR") : "—"]].map(([label, value]) => <article key={String(label)} className="border bg-white p-3"><p className="text-[9px] text-neutral-400">{label}</p><b>{value}</b></article>)}</section>
        <section className="border bg-white p-4 text-[10.5px]"><h2 className="text-[13px] font-medium">برچسب‌ها و خط زمانی</h2><div className="mt-2 flex flex-wrap gap-2">{(file.labels ?? []).map((label: any) => <span key={label.code} className="border px-2 py-1">{label.name}</span>)}{!(file.labels ?? []).length && <span className="text-neutral-400">برچسبی اعمال نشده است.</span>}</div><div className="mt-3 max-h-56 overflow-y-auto">{(file.timeline ?? []).map((item: any, index: number) => <p key={index} className="border-b py-1">{item.title} · {item.body}</p>)}</div><div className="mt-3">{(file.messages ?? []).map((item: any) => <p key={item.id}>{item.campaign} · {item.status} · {item.rendered}</p>)}{(file.notifications ?? []).map((item: any) => <p key={item.id}>{item.title} · {item.body}</p>)}{!(file.messages ?? []).length && !(file.notifications ?? []).length && <p className="text-neutral-400">پیامک یا اعلان ثبت‌شده‌ای نیست.</p>}</div></section>
        <div className="grid gap-3 lg:grid-cols-2">
          <RecordList title="تاریخچه عضویت" rows={file.history ?? []} render={(row) => `${row.action} · ${row.from_plan || "—"} → ${row.to_plan || "—"}`} />
          <RecordList title="فاکتورها" rows={file.invoices ?? []} render={(row) => `${row.number} · ${row.kind} · ${row.status}`} />
          <RecordList title="آدرس‌ها" rows={file.addresses ?? []} render={(row) => `${row.label} · ${row.city} · ${row.line}`} />
          <RecordList title="علاقه‌مندی‌ها" rows={file.favorites ?? []} render={(row) => row.name || row.product_id} />
          <RecordList title="مدارک" rows={file.documents ?? []} render={(row) => `${row.title} · ${row.status}`} />
          <RecordList title="تیکت‌ها" rows={file.tickets ?? []} render={(row) => `${row.subject} · ${row.status}`} />
          <RecordList title="مرجوعی و بازگشت وجه" rows={file.returns ?? []} render={(row) => `${row.memo} · ${money(Number(row.amount))}`} />
          <RecordList title="فعالیت CRM" rows={file.notes ?? []} render={(row) => `${row.kind} · ${row.body}`} />
        </div>
      </div>
    </div>}
  </section>;
}

export function CrmStudio() {
  const [labels, setLabels] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [labelCode, setLabelCode] = useState("expiring");
  const [body, setBody] = useState("{{customer.name}} عزیز، عضویت {{plan.name}} شما تا {{days_to_expiry}} روز دیگر منقضی می‌شود.");
  const reload = () => loadCrmLabels().then((data) => setLabels(data.labels ?? [])).catch(() => setError("برچسب‌ها خوانده نشد."));
  useEffect(() => { reload(); }, []);
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">CRM RULES</p><h1 className="mt-1 text-[18px] font-medium">برچسب هوشمند و پیامک</h1><p className="mt-1 text-[10.5px] leading-6 text-neutral-500">قواعد روی سرور و با داده واقعی سفارش و عضویت ارزیابی می‌شوند. کمپین فقط گیرنده‌های همان برچسب را هدف می‌گیرد.</p></header>
    <Banner error={error} notice={notice} />
    <button type="button" className={button} onClick={() => evaluateCrm().then((result) => { setNotice(`${result.assigned} برچسب روی ${result.buyers} خریدار اعمال شد.`); reload(); }).catch((reason) => setError(reason instanceof Error ? reason.message : "ارزیابی نشد."))}>ارزیابی قواعد</button>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">{labels.map((label) => <article key={label.id} className="border bg-white p-3 text-[11px]"><b>{label.name}</b><p className="text-neutral-400">{label.kind === "rule" ? "قاعده‌محور" : "دستی"} · {label.code}</p>{label.rule && <p className="mt-1 text-[9px] text-neutral-400" dir="ltr">{JSON.stringify(label.rule)}</p>}</article>)}</div>
    <form className="mt-4 max-w-xl space-y-2 border bg-white p-4" onSubmit={(event) => { event.preventDefault(); createCrmCampaign({ name: "کمپین برچسب", body, labelCode }).then((result) => setNotice(`کمپین برای ${result.recipients} گیرنده در صف ماند.`)).catch((reason) => setError(reason instanceof Error ? reason.message : "کمپین ساخته نشد.")); }}>
      <select aria-label="برچسب هدف" value={labelCode} onChange={(event) => setLabelCode(event.target.value)} className={field}>{labels.map((label) => <option key={label.code} value={label.code}>{label.name}</option>)}</select>
      <textarea aria-label="متن پیامک" value={body} onChange={(event) => setBody(event.target.value)} rows={4} className="w-full border p-2 text-[11px]" />
      <button className={button}>ساخت کمپین پیامکی</button>
    </form>
    <ManualLabel />
    <AutomationForm onError={setError} onNotice={setNotice} />
  </section>;
}

function AutomationForm({ onError, onNotice }: { onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [eventName, setEventName] = useState("cart.abandoned");
  const [action, setAction] = useState("sms");
  useEffect(() => { loadAutomations().then((data) => setItems(data.automations ?? [])).catch(() => onError("اتوماسیون‌ها خوانده نشد.")); }, [onError]);
  return <form className="mt-4 max-w-xl space-y-2 border bg-white p-4" onSubmit={(event) => { event.preventDefault(); saveAutomation({ name: "اتوماسیون برچسب", eventName, action, labelCode: action === "sms" ? "abandoned_cart" : undefined, body: "{{customer.name}} سبد شما هنوز باز است.", couponCode: action === "coupon" ? "RETURN10" : undefined }).then(() => { onNotice("اتوماسیون روی سرور ذخیره شد. وب‌هوک فقط از مرکز اتصال می‌رود."); return loadAutomations(); }).then((data) => setItems(data.automations ?? [])).catch((reason) => onError(reason instanceof Error ? reason.message : "اتوماسیون ذخیره نشد.")); }}>
    <h2 className="text-[13px] font-medium">اتوماسیون رویداد</h2>
    <p className="text-[10px] leading-5 text-neutral-500">رویداد به قاعده، برچسب و اقدام می‌رسد. آدرس n8n اینجا ذخیره نمی‌شود.</p>
    <select aria-label="رویداد اتوماسیون" value={eventName} onChange={(event) => setEventName(event.target.value)} className={field}>{["cart.abandoned", "order.paid", "membership.expiring", "membership.activated", "ticket.created"].map((item) => <option key={item}>{item}</option>)}</select>
    <select aria-label="اقدام اتوماسیون" value={action} onChange={(event) => setAction(event.target.value)} className={field}><option value="sms">پیامک</option><option value="notification">اعلان</option><option value="note">یادداشت CRM</option><option value="coupon">کوپن</option></select>
    <button className={button}>ذخیره اتوماسیون</button>
    <div className="text-[10.5px]">{items.map((item) => <p key={item.id}>{item.name} · {item.event_name} · {item.action}</p>)}</div>
  </form>;
}

function ManualLabel() {
  const [subjectId, setSubjectId] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  return <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); assignCrmLabel({ labelCode: "vip", subjectId, note }).then(() => setMessage("برچسب دستی ثبت شد.")).catch((reason) => setMessage(reason instanceof Error ? reason.message : "ثبت نشد.")); }}>
    <input aria-label="شناسه خریدار برای برچسب" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder="شناسه حساب خریدار" className="h-10 border px-3 text-[11px]" />
    <input aria-label="یادداشت برچسب" value={note} onChange={(event) => setNote(event.target.value)} placeholder="یادداشت" className="h-10 border px-3 text-[11px]" />
    <button className={button}>برچسب دستی VIP</button>
    {message && <span className="text-[10px]">{message}</span>}
  </form>;
}

export function InvoiceCenter() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [variables, setVariables] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});
  const [kindLabels, setKindLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ title: "فاکتور فروش", seller: "کلبه وینتیج", address: "تهران", taxId: "14000000000", terms: "سند {{invoice.number}} برای {{customer.name}}", footer: "{{seller.name}}", signature: "امضای مالی", stamp: "مهر کلبه", showSeller: true, showBuyer: true, showItems: true, showTotals: true, showPayment: true });
  const reload = () => Promise.all([loadInvoiceTemplates(), loadInvoices()]).then(([templateData, invoiceData]) => { setTemplates(templateData.templates ?? []); setVariables(templateData.variables ?? []); setInvoices(invoiceData.invoices ?? []); setStatusLabels(invoiceData.statusLabels ?? {}); setKindLabels(invoiceData.kindLabels ?? {}); }).catch(() => setError("فاکتورها خوانده نشد."));
  useEffect(() => { reload(); }, []);
  const show = ["seller", "buyer", "supplier", "items", "totals", "payment", "terms", "footer", "signature", "stamp"].filter((section) => {
    if (section === "seller") return form.showSeller;
    if (section === "buyer") return form.showBuyer;
    if (section === "items") return form.showItems;
    if (section === "totals") return form.showTotals;
    if (section === "payment") return form.showPayment;
    return true;
  });
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">INVOICE ENGINE</p><h1 className="mt-1 text-[18px] font-medium">قالب و اسناد مالی</h1><p className="mt-1 text-[10.5px] leading-6 text-neutral-500">قالب، ترتیب بخش‌ها و متغیرها روی سرور ذخیره می‌شوند. سند صادرشده اسنپ‌شاب زمان صدور است.</p></header>
    <Banner error={error} notice={notice} />
    <form className="grid max-w-3xl gap-2 border bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); saveInvoiceTemplate({ code: "official", name: form.title, kind: "wholesale", body: { title: form.title, logoText: "کلبه وینتیج", seller: { name: form.seller, address: form.address, taxId: form.taxId }, terms: form.terms, footer: form.footer, signature: form.signature, stamp: form.stamp, show, columns: ["name", "sku", "variant", "quantity", "unitPrice", "discount", "total"] } }).then((result: any) => { setNotice(`نسخه ${result.version} ذخیره شد. اسناد قبلی روی نسخه خودشان می‌مانند.`); reload(); }).catch((reason) => setError(reason instanceof Error ? reason.message : "قالب ذخیره نشد.")); }}>
      <label className="text-[10px] text-neutral-500">عنوان<input aria-label="عنوان قالب فاکتور" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={field} /></label>
      <label className="text-[10px] text-neutral-500">فروشنده<input aria-label="نام فروشنده" value={form.seller} onChange={(event) => setForm({ ...form, seller: event.target.value })} className={field} /></label>
      <label className="text-[10px] text-neutral-500">آدرس فروشنده<input aria-label="آدرس فروشنده" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={field} /></label>
      <label className="text-[10px] text-neutral-500">شناسه مالیاتی<input aria-label="شناسه مالیاتی" value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} className={field} /></label>
      <label className="text-[10px] text-neutral-500 sm:col-span-2">شرایط<textarea aria-label="شرایط فاکتور" value={form.terms} onChange={(event) => setForm({ ...form, terms: event.target.value })} className="mt-1 w-full border p-2 text-[11px]" rows={2} /></label>
      <label className="text-[10px] text-neutral-500">پاورقی<input aria-label="پاورقی فاکتور" value={form.footer} onChange={(event) => setForm({ ...form, footer: event.target.value })} className={field} /></label>
      <label className="text-[10px] text-neutral-500">امضا<input aria-label="امضای فاکتور" value={form.signature} onChange={(event) => setForm({ ...form, signature: event.target.value })} className={field} /></label>
      <label className="text-[10px] text-neutral-500">مهر<input aria-label="مهر فاکتور" value={form.stamp} onChange={(event) => setForm({ ...form, stamp: event.target.value })} className={field} /></label>
      <div className="flex flex-wrap gap-3 text-[10px] sm:col-span-2">{[["showSeller", "فروشنده"], ["showBuyer", "خریدار"], ["showItems", "اقلام"], ["showTotals", "جمع"], ["showPayment", "پرداخت"]].map(([key, label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(form[key as keyof typeof form])} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />{label}</label>)}</div>
      <p className="text-[9px] text-neutral-400 sm:col-span-2">متغیرهای مجاز: {variables.join(" · ")}</p>
      <button className={button}>ذخیره نسخه جدید قالب</button>
    </form>
    <div className="mt-4 text-[11px]">{templates.slice(0, 4).map((template) => <p key={template.id}>{template.name} · v{template.version} · {template.active ? "فعال" : "بایگانی"}</p>)}</div>
    <div className="mt-4 divide-y border bg-white">{invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"><span className="num-fa">{invoice.number} · {kindLabels[invoice.kind] || invoice.kind} · {statusLabels[invoice.status] || invoice.status} · قالب v{invoice.template_version}</span><span className="flex gap-2"><button type="button" className="underline" onClick={() => setInvoiceStatus(invoice.id, "paid", "تسویه سند").then(() => reload()).catch(() => setError("تغییر وضعیت سند مجاز نیست."))}>پرداخت‌شده</button><button type="button" className="underline" onClick={() => openInvoicePdf(invoice.id).catch(() => setError("دریافت PDF نیاز به دسترسی دارد."))}>PDF</button></span></div>)}{!invoices.length && <p className="p-4 text-[11px] text-neutral-400">هنوز سندی صادر نشده است. با پرداخت تأییدشده، تسویه یا صورت‌حساب، سند از همین موتور ساخته می‌شود.</p>}</div>
  </section>;
}

export function IntegrationCenter() {
  const [data, setData] = useState<{ endpoints: any[]; deliveries: any[]; events: string[] }>({ endpoints: [], deliveries: [], events: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "n8n بازاریابی", url: "", secret: "", event: "membership.activated" });
  const reload = () => loadIntegrations().then(setData).catch(() => setError("اتصال‌ها خوانده نشد."));
  useEffect(() => { reload(); }, []);
  return <section>
    <header className="mb-4"><p className="text-[9px] tracking-[0.18em] text-neutral-400">INTEGRATION CENTER</p><h1 className="mt-1 text-[18px] font-medium">اتصال n8n و رویدادها</h1><p className="mt-1 text-[10.5px] leading-6 text-neutral-500">آدرس وب‌هوک فقط از همین فرم در پایگاه‌داده ذخیره می‌شود و در فرانت ثابت نیست. راز اتصال به فروشگاه برنمی‌گردد.</p></header>
    <Banner error={error} notice={notice} />
    <form className="grid max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); saveIntegration({ name: form.name, url: form.url, secret: form.secret, events: [form.event] }).then(() => { setNotice("اتصال ذخیره شد."); setForm({ ...form, secret: "" }); reload(); }).catch((reason) => setError(reason instanceof Error ? reason.message : "ذخیره نشد.")); }}>
      <input aria-label="نام اتصال" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={field} />
      <input aria-label="آدرس وب‌هوک" dir="ltr" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://" className={field} />
      <input aria-label="راز اتصال" type="password" value={form.secret} onChange={(event) => setForm({ ...form, secret: event.target.value })} className={field} />
      <select aria-label="رویداد" value={form.event} onChange={(event) => setForm({ ...form, event: event.target.value })} className={field}>{(data.events.length ? data.events : ["membership.activated"]).map((event) => <option key={event}>{event}</option>)}</select>
      <button className={button}>ذخیره اتصال</button>
    </form>
    <div className="mt-4 text-[11px]">{data.endpoints.map((item) => <p key={item.id}>{item.name} · {item.kind} · {item.active ? "فعال" : "خاموش"} · {item.url}</p>)}{data.deliveries.slice(0, 8).map((item) => <p key={item.id} className="text-neutral-500">{item.event_name} · {item.status} · {item.detail}</p>)}</div>
  </section>;
}
