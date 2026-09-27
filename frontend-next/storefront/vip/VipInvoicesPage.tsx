import { useMemo, useState } from "react";
import { Button, Dialog, EmptyState, InvoiceCard, Money, StatusBadge } from "../../shared/components";
import { canonicalClient } from "../../shared/http/clients";
import { buyerApi, type BuyerInvoice, type BuyerOrder } from "../../shared/vip/buyer";
import { faDate, RemoteBoundary, statusLabel, useRemote, VipRoutePage } from "./VipPageParts";

export function VipInvoicesPage() {
  const api = useMemo(() => buyerApi(canonicalClient()), []); const orders = useRemote(() => api.orders(), [api]); const [order, setOrder] = useState<BuyerOrder | null>(null);
  return <VipRoutePage eyebrow="DOCUMENTS" title="فاکتورها" description="فاکتورها بر اساس سفارش و فقط هنگام درخواست از سرور خوانده می‌شوند."><RemoteBoundary state={orders}>{(data) => data.orders.length ? <div className="vip-record-list">{data.orders.map((item) => <button type="button" className="vip-order-index" key={item.id} onClick={() => setOrder(item)}><span><strong>{item.orderCode}</strong><small>{faDate(item.createdAt)}</small></span><StatusBadge>{statusLabel(item.status)}</StatusBadge><Money value={item.grandTotal} /></button>)}</div> : <EmptyState title="سفارشی برای جست‌وجوی فاکتور وجود ندارد" description="فهرست فاکتورها عمداً از سفارش‌های متعلق به همین حساب ساخته می‌شود." />}</RemoteBoundary>{order ? <OrderInvoices order={order} api={api} onClose={() => setOrder(null)} /> : null}</VipRoutePage>;
}

function OrderInvoices({ order, api, onClose }: { order: BuyerOrder; api: ReturnType<typeof buyerApi>; onClose: () => void }) {
  const remote = useRemote(() => api.invoices(order.id), [api, order.id]); const [selected, setSelected] = useState<BuyerInvoice | null>(null);
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }} title={`فاکتورهای سفارش ${order.orderCode}`} description="اسناد تجاری صادرشده برای این سفارش"><RemoteBoundary state={remote}>{({ invoices }) => invoices.length ? <div className="vip-card-grid">{invoices.map((invoice) => <InvoiceCard key={invoice.id} title="فاکتور تجاری" invoiceCode={invoice.invoiceNumber} amount={invoice.grandTotal} dueAt={faDate(invoice.issuedAt)} status={{ label: statusLabel(invoice.status) }} actions={<Button variant="secondary" onClick={() => setSelected(invoice)}>جزئیات</Button>} />)}</div> : <EmptyState title="هنوز فاکتوری صادر نشده است" description="صدور سند مالی در سمت سرور انجام می‌شود و پس از صدور اینجا ظاهر خواهد شد." />}</RemoteBoundary>{selected ? <InvoiceDetail id={selected.id} api={api} onClose={() => setSelected(null)} /> : null}</Dialog>;
}

function InvoiceDetail({ id, api, onClose }: { id: string; api: ReturnType<typeof buyerApi>; onClose: () => void }) {
  const remote = useRemote(() => api.invoice(id), [api, id]); return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }} title="جزئیات فاکتور"><RemoteBoundary state={remote}>{({ invoice }) => <div className="vip-detail-stack"><div className="vip-detail-summary"><bdi dir="ltr">{invoice.invoiceNumber}</bdi><StatusBadge>{statusLabel(invoice.status)}</StatusBadge><Money value={invoice.grandTotal} /></div><div className="vip-line-list">{invoice.lines?.map((line) => <div key={line.lineNo}><span>{line.description}</span><small>{line.quantity} واحد</small><Money value={line.lineTotal} /></div>)}</div>{invoice.voidedAt ? <p>ابطال: {faDate(invoice.voidedAt)}</p> : null}</div>}</RemoteBoundary></Dialog>;
}
