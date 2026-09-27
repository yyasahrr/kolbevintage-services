import { useEffect, useState } from "react";
import { canonicalClient } from "../../shared/http/clients";

type Contact = {
  id: string; name: string; phone: string | null; email: string | null; city: string | null;
  stage: string; assignedAdminName: string | null;
};
type ContactList = { items: Contact[]; total: number; limit: number; offset: number };
type ContactDetail = { contact: Contact };

const STAGES = [
  ["", "همهٔ مراحل"], ["LEAD", "سرنخ"], ["CONTACTED", "تماس گرفته‌شده"],
  ["NEGOTIATION", "در مذاکره"], ["ACTIVE_CUSTOMER", "مشتری فعال"],
  ["LOYAL", "وفادار"], ["CHURNED", "ریزش‌یافته"],
] as const;
const stageLabel = (value: string) => STAGES.find(([key]) => key === value)?.[1] ?? value;
const PAGE_SIZE = 20;

export default function AdminCRM({ initialView = "overview" }: { initialView?: string }) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<ContactList | null>(null);
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (initialView === "vip") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    canonicalClient().request<ContactList>("/admin/crm/contacts", {
      query: { search: search || undefined, stage: stage || undefined, limit: PAGE_SIZE, offset },
      signal: controller.signal,
    }).then(setList).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "فهرست مشتریان در دسترس نیست.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialView, search, stage, offset, reload]);

  const openContact = async (id: string) => {
    setDetail(null);
    setDetailError("");
    try {
      setDetail(await canonicalClient().request<ContactDetail>(`/admin/crm/contacts/${encodeURIComponent(id)}`));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "پروندهٔ مشتری در دسترس نیست.");
    }
  };

  if (initialView === "vip") return <main className="kolbe-ops-page" dir="rtl">
    <header className="kolbe-ops-heading"><p>VIP / CRM</p><h1>مشتریان VIP</h1></header>
    <section className="kolbe-ops-state" role="status"><h2>فیلتر VIP در CRM موجود نیست</h2><p>عضویت VIP در سرویس عضویت نگهداری می‌شود. این نما تا اتصال مالکانهٔ دو دامنه، فهرست یا آمار عضویت نمایش نمی‌دهد.</p></section>
  </main>;

  return <main className="kolbe-ops-page" dir="rtl">
    <header className="kolbe-ops-heading"><p>CRM / CONTACTS</p><h1>پرونده‌های مشتریان</h1><span>اطلاعات از سرویس CRM خوانده می‌شود.</span></header>
    <form className="kolbe-ops-toolbar" onSubmit={(event) => { event.preventDefault(); setOffset(0); setSearch(input.trim()); }}>
      <label>جست‌وجوی مشتری<input className="kolbe-input" type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder="نام، تلفن، ایمیل یا شهر" /></label>
      <label>مرحله<select className="kolbe-input" value={stage} onChange={(event) => { setStage(event.target.value); setOffset(0); }}>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="kolbe-button" type="submit">جست‌وجو</button>
    </form>
    {error ? <section className="kolbe-ops-state" role="alert"><h2>دریافت اطلاعات انجام نشد</h2><p>{error}</p><button className="kolbe-button" type="button" onClick={() => setReload((value) => value + 1)}>تلاش دوباره</button></section> :
      loading ? <section className="kolbe-ops-state" role="status" aria-live="polite">در حال دریافت پرونده‌ها…</section> :
      list?.items.length ? <>
        <div className="kolbe-ops-list" aria-label="فهرست مشتریان">{list.items.map((contact) => <button className="kolbe-ops-row" key={contact.id} type="button" onClick={() => void openContact(contact.id)}>
          <span className="kolbe-ops-row__name">{contact.name}<small>{contact.city || "شهر ثبت نشده"}</small></span>
          <span>{stageLabel(contact.stage)}</span><span dir="ltr">{contact.phone || contact.email || "—"}</span><span>{contact.assignedAdminName || "تخصیص‌نیافته"}</span>
        </button>)}</div>
        <nav className="kolbe-ops-pagination" aria-label="صفحه‌بندی مشتریان"><span>{new Intl.NumberFormat("fa-IR").format(offset + 1)} تا {new Intl.NumberFormat("fa-IR").format(Math.min(offset + list.items.length, list.total))} از {new Intl.NumberFormat("fa-IR").format(list.total)}</span><div><button type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>قبلی</button><button type="button" disabled={offset + PAGE_SIZE >= list.total} onClick={() => setOffset((value) => value + PAGE_SIZE)}>بعدی</button></div></nav>
      </> : <section className="kolbe-ops-state" role="status"><h2>پرونده‌ای یافت نشد</h2><p>عبارت جست‌وجو یا مرحله را تغییر دهید.</p></section>}
    {detailError ? <p className="kolbe-ops-error" role="alert">{detailError}</p> : null}
    {detail ? <section className="kolbe-ops-detail" aria-label="جزئیات مشتری"><div><p>پروندهٔ CRM</p><button type="button" onClick={() => setDetail(null)} aria-label="بستن جزئیات">×</button></div><h2>{detail.contact.name}</h2><dl><dt>مرحله</dt><dd>{stageLabel(detail.contact.stage)}</dd><dt>تلفن</dt><dd dir="ltr">{detail.contact.phone || "—"}</dd><dt>ایمیل</dt><dd dir="ltr">{detail.contact.email || "—"}</dd><dt>شهر</dt><dd>{detail.contact.city || "—"}</dd><dt>مسئول</dt><dd>{detail.contact.assignedAdminName || "تخصیص‌نیافته"}</dd></dl></section> : null}
  </main>;
}
