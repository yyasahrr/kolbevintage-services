import { useMemo, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { Button, Dialog, EmptyState, InlineNotice, SelectField, SupportCaseCard, TextField } from "../../shared/components";
import { canonicalClient } from "../../shared/http/clients";
import { buyerApi, type BuyerSupportCase } from "../../shared/vip/buyer";
import { faDate, RemoteBoundary, statusLabel, useRemote, VipRoutePage } from "./VipPageParts";

const categories = [["ORDER", "سفارش"], ["PAYMENT", "پرداخت"], ["SHIPPING", "ارسال"], ["MEMBERSHIP", "عضویت"], ["WHOLESALE", "خرید عمده"], ["PRODUCT", "محصول"], ["QUALITY", "کیفیت"], ["ACCOUNT", "حساب"], ["OTHER", "سایر"]] as const;

export function VipSupportPage() {
  const api = useMemo(() => buyerApi(canonicalClient()), []); const list = useRemote(() => api.supportCases(), [api]);
  const [createOpen, setCreateOpen] = useState(false); const [selected, setSelected] = useState<BuyerSupportCase | null>(null);
  return <VipRoutePage eyebrow="CUSTOMER CARE" title="پشتیبانی" description="پرونده‌های واقعی سفارش، پرداخت، ارسال و حساب عمده.">
    <div className="vip-page-actions"><Button onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" /> پرونده جدید</Button></div>
    <RemoteBoundary state={list}>{({ cases }) => cases.length ? <div className="vip-card-grid">{cases.map((item) => <SupportCaseCard key={item.id} title={item.subject} caseCode={item.publicReference} updatedAt={faDate(item.updatedAt)} status={{ label: statusLabel(item.status) }} summary={categories.find(([key]) => key === item.category)?.[1] || item.category} actions={<Button variant="secondary" onClick={() => setSelected(item)}>گفت‌وگو</Button>} />)}</div> : <EmptyState title="پرونده‌ای ندارید" description="اگر در خرید عمده به کمک نیاز دارید، یک پرونده رسمی بسازید." action={<Button onClick={() => setCreateOpen(true)}><MessageCircle aria-hidden="true" /> شروع گفت‌وگو</Button>} />}</RemoteBoundary>
    <NewCaseDialog open={createOpen} api={api} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); list.reload(); }} />
    {selected ? <CaseDialog item={selected} api={api} onClose={() => setSelected(null)} /> : null}
  </VipRoutePage>;
}

function NewCaseDialog({ open, api, onClose, onCreated }: { open: boolean; api: ReturnType<typeof buyerApi>; onClose: () => void; onCreated: () => void }) {
  const [category, setCategory] = useState("ORDER"); const [priority, setPriority] = useState("NORMAL"); const [subject, setSubject] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await api.createSupportCase({ category, priority, subject: subject.trim(), initialMessage: message.trim() || undefined }); onCreated(); } catch (reason) { setError(reason instanceof Error ? reason.message : "ثبت پرونده ممکن نشد"); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="پرونده پشتیبانی جدید" description="موضوع را کوتاه و دقیق بنویسید."><form className="vip-form-grid" onSubmit={(e) => void submit(e)}><SelectField label="دسته" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="اولویت" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="LOW">کم</option><option value="NORMAL">عادی</option><option value="HIGH">زیاد</option><option value="URGENT">فوری</option></SelectField><TextField className="vip-form-span" label="موضوع" value={subject} onChange={(e) => setSubject(e.target.value)} required /><TextField className="vip-form-span" label="پیام نخست" value={message} onChange={(e) => setMessage(e.target.value)} />{error ? <InlineNotice intent="danger" className="vip-form-span">{error}</InlineNotice> : null}<div className="vip-form-actions vip-form-span"><Button variant="quiet" onClick={onClose}>انصراف</Button><Button type="submit" disabled={busy || !subject.trim()}>{busy ? "در حال ثبت" : "ثبت پرونده"}</Button></div></form></Dialog>;
}

function CaseDialog({ item, api, onClose }: { item: BuyerSupportCase; api: ReturnType<typeof buyerApi>; onClose: () => void }) {
  const detail = useRemote(() => api.supportCase(item.id), [api, item.id]); const [body, setBody] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const idem = useRef(crypto.randomUUID());
  const send = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await api.addSupportMessage(item.id, body.trim(), idem.current); setBody(""); idem.current = crypto.randomUUID(); detail.reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "ارسال پیام ممکن نشد"); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }} title={item.subject} description={`پرونده ${item.publicReference}`} className="vip-detail-dialog"><RemoteBoundary state={detail}>{(data) => <div className="vip-detail-stack"><div className="vip-message-list">{data.messages.length ? data.messages.map((message) => <article key={message.id} data-author={message.authorType === "VIP_BUYER" ? "buyer" : "support"}><strong>{message.authorDisplayName || (message.authorType === "VIP_BUYER" ? "شما" : "پشتیبانی")}</strong><p>{message.body}</p><time>{faDate(message.createdAt)}</time></article>) : <p className="vip-muted">هنوز پیامی ثبت نشده است.</p>}</div><form className="vip-reply" onSubmit={(e) => void send(e)}><TextField label="پاسخ شما" value={body} onChange={(e) => setBody(e.target.value)} required />{error ? <InlineNotice intent="danger">{error}</InlineNotice> : null}<Button type="submit" disabled={busy || !body.trim()}>{busy ? "در حال ارسال" : "ارسال پیام"}</Button></form></div>}</RemoteBoundary></Dialog>;
}
