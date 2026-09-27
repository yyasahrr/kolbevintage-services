import { useMemo, useRef, useState } from "react";
import { ExternalLink, XCircle } from "lucide-react";
import { Button, Dialog, EmptyState, InlineNotice, Money, OrderCard, StatusBadge, Surface, TextField } from "../../shared/components";
import { canonicalClient } from "../../shared/http/clients";
import { buyerApi, type BuyerOrder } from "../../shared/vip/buyer";
import { faDate, RemoteBoundary, statusLabel, useRemote, VipRoutePage } from "./VipPageParts";

export function VipOrdersPage() {
  const api = useMemo(() => buyerApi(canonicalClient()), []);
  const list = useRemote(() => api.orders(), [api]);
  const [selected, setSelected] = useState<BuyerOrder | null>(null);
  const [loadingMore, setLoadingMore] = useState(false); const [moreError, setMoreError] = useState("");
  const loadMore = async () => { if (!list.data?.nextCursor || loadingMore) return; setLoadingMore(true); setMoreError(""); try { const next = await api.orders(list.data.nextCursor); list.setData((current) => current ? { ...next, orders: [...current.orders, ...next.orders.filter((item) => !current.orders.some((old) => old.id === item.id))] } : next); } catch (reason) { setMoreError(reason instanceof Error ? reason.message : "دریافت صفحهٔ بعد ممکن نشد"); } finally { setLoadingMore(false); } };
  return <VipRoutePage eyebrow="ORDER HISTORY" title="سفارش‌ها" description="وضعیت، ارسال، اسناد و رخدادهای سفارش‌های همین حساب.">
    <RemoteBoundary state={list}>{({ orders, hasMore }) => orders.length ? <><div className="vip-card-grid">{orders.map((order) => <OrderCard key={order.id} title={`سفارش ${order.orderCode}`} orderCode={order.orderCode} total={order.grandTotal} placedAt={faDate(order.createdAt)} status={{ label: statusLabel(order.status) }} actions={<Button variant="secondary" onClick={() => setSelected(order)}>مشاهده جزئیات</Button>} />)}</div>{moreError ? <InlineNotice intent="danger">{moreError}</InlineNotice> : null}{hasMore ? <div className="vip-page-actions"><Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "در حال دریافت" : "نمایش سفارش‌های بیشتر"}</Button></div> : null}</> : <EmptyState title="هنوز سفارشی ثبت نشده است" description="پس از پذیرفته‌شدن درخواست عمده، سفارش‌های واقعی اینجا ظاهر می‌شوند." />}</RemoteBoundary>
    {selected ? <OrderDetail order={selected} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); list.reload(); }} api={api} /> : null}
  </VipRoutePage>;
}

function OrderDetail({ order, onClose, onChanged, api }: { order: BuyerOrder; onClose: () => void; onChanged: () => void; api: ReturnType<typeof buyerApi> }) {
  const detail = useRemote(async () => {
    const [core, timeline, shipments, invoices] = await Promise.all([api.order(order.id), api.timeline(order.id), api.shipments(order.id), api.invoices(order.id)]);
    return { core, timeline: timeline.timeline, shipments: shipments.shipments, invoices: invoices.invoices };
  }, [api, order.id]);
  const [cancelOpen, setCancelOpen] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const commandKey = useRef(crypto.randomUUID());
  const cancel = async () => { setBusy(true); setError(""); try { await api.cancelOrder(order.id, reason.trim(), detail.data?.core.order.version, commandKey.current); setCancelOpen(false); onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "لغو سفارش ممکن نشد"); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={`جزئیات سفارش ${order.orderCode}`} description="اطلاعات زیر مستقیماً از سرویس‌های سفارش، ارسال و صدور فاکتور خوانده شده است." className="vip-detail-dialog">
    <RemoteBoundary state={detail}>{({ core, timeline, shipments, invoices }) => <div className="vip-detail-stack">
      <div className="vip-detail-summary"><StatusBadge>{statusLabel(core.order.status)}</StatusBadge><strong><Money value={core.order.grandTotal} /></strong><span>{core.order.totalUnits} واحد</span></div>
      <section><h3>اقلام</h3>{core.items.length ? <div className="vip-line-list">{core.items.map((item) => <div key={item.id}><span>{item.productNameSnapshot || item.skuSnapshot || "قلم سفارش"}</span><small>{item.pieceQuantity ?? item.quantity} عدد</small><Money value={item.lineTotal} /></div>)}</div> : <p>قلمی گزارش نشده است.</p>}</section>
      <section><h3>ارسال‌ها</h3>{shipments.length ? shipments.map((shipment) => <Surface key={shipment.id} density="compact" className="vip-record-row"><div><strong>{shipment.shipmentCode}</strong><small>{shipment.carrierDisplayName || "حمل‌کننده اعلام نشده"}</small></div><StatusBadge>{statusLabel(shipment.status)}</StatusBadge>{shipment.trackingCode ? <bdi dir="ltr">{shipment.trackingCode}</bdi> : null}{shipment.trackingUrl ? <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">رهگیری <ExternalLink aria-hidden="true" /></a> : null}</Surface>) : <p className="vip-muted">هنوز محموله‌ای برای این سفارش ثبت نشده است.</p>}</section>
      <section><h3>فاکتورها</h3>{invoices.length ? invoices.map((invoice) => <div className="vip-record-row" key={invoice.id}><span>{invoice.invoiceNumber}</span><StatusBadge>{statusLabel(invoice.status)}</StatusBadge><Money value={invoice.grandTotal} /></div>) : <p className="vip-muted">هنوز فاکتوری صادر نشده است.</p>}</section>
      <section><h3>زیرسفارش‌ها و استثناها</h3><p>{core.children.length} زیرسفارش · {core.exceptions.length} استثنای ثبت‌شده</p></section>
      <section><h3>خط زمانی</h3>{timeline.length ? <ol className="vip-timeline">{timeline.map((event, index) => <li key={event.id ?? index}><strong>{event.title || statusLabel(event.type)}</strong><time>{faDate(event.occurredAt || event.createdAt)}</time>{event.description ? <p>{event.description}</p> : null}</li>)}</ol> : <p className="vip-muted">رخدادی ثبت نشده است.</p>}</section>
      {!['cancelled','delivered'].includes(core.order.status.toLowerCase()) ? <Button variant="danger" onClick={() => { commandKey.current = crypto.randomUUID(); setCancelOpen(true); }}><XCircle aria-hidden="true" /> درخواست لغو</Button> : null}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="لغو سفارش" description="لغو تنها در وضعیت‌های مجاز سرور انجام می‌شود." footer={<><Button variant="quiet" onClick={() => setCancelOpen(false)}>انصراف</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void cancel()}>{busy ? "در حال ثبت" : "تأیید لغو"}</Button></>}><TextField label="دلیل لغو" value={reason} onChange={(e) => setReason(e.target.value)} required />{error ? <InlineNotice intent="danger">{error}</InlineNotice> : null}</Dialog>
    </div>}</RemoteBoundary>
  </Dialog>;
}
