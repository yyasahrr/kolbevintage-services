import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { fa, toman } from "../utils/format";
import {
  FULFILLMENT_STATUS_LABEL,
  OPERATIONS_SORTS,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  approveWholesaleOrder,
  cancelWholesaleOrder,
  listWholesaleFulfillmentOrders,
  updateOrderOperations,
  type AdminWholesaleOrder,
} from "../lib/wholesaleApi";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";
const field = `h-10 border border-neutral-300 bg-white px-3 text-[11px] ${focusRing}`;

function when(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function priorityLabel(value: number) {
  if (value >= 80) return "فوری";
  if (value >= 40) return "بالا";
  return "عادی";
}

export default function WholesaleOperationsDesk({ onChanged }: { onChanged?: () => void }) {
  const [sort, setSort] = useState("priority");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");
  const [fulfillment, setFulfillment] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "status" | "fulfillment">("status");
  const [orders, setOrders] = useState<AdminWholesaleOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    return listWholesaleFulfillmentOrders({ sort, q: query.trim(), status, payment, fulfillment })
      .then((next) => {
        setOrders(next);
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "میز عملیات به‌روز نشد."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [sort, status, payment, fulfillment]);

  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ id: "all", label: "همه سفارش‌ها", items: orders }];
    const keyOf = (order: AdminWholesaleOrder) => groupBy === "status" ? order.status : order.fulfillmentStatus;
    const labelOf = (key: string) => groupBy === "status" ? (ORDER_STATUS_LABEL[key] ?? key) : (FULFILLMENT_STATUS_LABEL[key] ?? key);
    const buckets = new Map<string, AdminWholesaleOrder[]>();
    for (const order of orders) {
      const key = keyOf(order);
      buckets.set(key, [...(buckets.get(key) ?? []), order]);
    }
    return [...buckets.entries()].map(([id, items]) => ({ id, label: labelOf(id), items }));
  }, [orders, groupBy]);

  const saveOps = async (patch: { paymentStatus?: string; fulfillmentStatus?: string; operationalPriority?: number }) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await updateOrderOperations(selected.id, patch);
      setNotice("وضعیت عملیاتی سفارش ذخیره شد.");
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ذخیره وضعیت انجام نشد.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: "approve" | "cancel") => {
    if (!selected) return;
    setBusy(true);
    try {
      if (action === "approve") await approveWholesaleOrder(selected.id);
      else await cancelWholesaleOrder(selected.id);
      setNotice(action === "approve" ? "سفارش تأیید شد." : "سفارش لغو شد.");
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تغییر وضعیت سفارش انجام نشد.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[9px] tracking-[0.22em] text-neutral-400">KOLBE OPERATIONS DESK</p>
          <h1 className="mt-2 text-[20px] font-medium">میز عملیات کلبه</h1>
          <p className="mt-1.5 max-w-3xl text-[10.5px] leading-6 text-neutral-500">جست‌وجو، فیلتر، مرتب‌سازی و دسته‌بندی سفارش‌های عمده. تغییر وضعیت پرداخت، آماده‌سازی و اولویت از همین میز ذخیره می‌شود و جزئیات کامل کنار فهرست باز می‌ماند.</p>
        </div>
      </header>
      <div className="mb-4 grid gap-2 border border-neutral-200 bg-white p-3 lg:grid-cols-[1.4fr_repeat(4,minmax(0,0.7fr))]">
        <label className="text-[9.5px] text-neutral-500">جست‌وجو
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(); }} placeholder="کد، خریدار، تأمین‌کننده، SKU" className={`${field} mt-1 w-full`} />
        </label>
        <label className="text-[9.5px] text-neutral-500">وضعیت سفارش
          <select aria-label="فیلتر وضعیت سفارش" value={status} onChange={(event) => setStatus(event.target.value)} className={`${field} mt-1 w-full`}>
            <option value="all">همه</option>
            {Object.entries(ORDER_STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="text-[9.5px] text-neutral-500">پرداخت
          <select aria-label="فیلتر وضعیت پرداخت" value={payment} onChange={(event) => setPayment(event.target.value)} className={`${field} mt-1 w-full`}>
            <option value="all">همه</option>
            {Object.entries(PAYMENT_STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="text-[9.5px] text-neutral-500">آماده‌سازی / ارسال
          <select aria-label="فیلتر آماده‌سازی" value={fulfillment} onChange={(event) => setFulfillment(event.target.value)} className={`${field} mt-1 w-full`}>
            <option value="all">همه</option>
            {Object.entries(FULFILLMENT_STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="text-[9.5px] text-neutral-500">مرتب‌سازی
          <select aria-label="مرتب‌سازی میز عملیات" value={sort} onChange={(event) => setSort(event.target.value)} className={`${field} mt-1 w-full`}>
            {OPERATIONS_SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={load} className={`h-9 bg-[#011c3a] px-3 text-[10px] text-white ${focusRing}`}>اعمال جست‌وجو</button>
        <span className="text-[10px] text-neutral-400">دسته‌بندی</span>
        {([["status", "وضعیت سفارش"], ["fulfillment", "آماده‌سازی"], ["none", "فهرست یکپارچه"]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setGroupBy(id)} className={`h-9 border px-3 text-[10px] ${focusRing} ${groupBy === id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 bg-white"}`}>{label}</button>
        ))}
        <span className="text-[10px] text-neutral-400 num-fa">{loading ? "در حال همگام‌سازی…" : `${fa(orders.length)} سفارش`}</span>
      </div>
      {error && <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-3 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">{notice}</p>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.id} className="border border-neutral-200 bg-white">
              <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                <h2 className="text-[12px] font-medium">{group.label}</h2>
                <span className="text-[10px] text-neutral-400 num-fa">{fa(group.items.length)}</span>
              </header>
              <div className="divide-y">
                {group.items.map((order) => (
                  <button key={order.id} type="button" onClick={() => setSelectedId(order.id)} className={`flex w-full flex-wrap items-center gap-3 px-4 py-3 text-right ${focusRing} ${selectedId === order.id ? "bg-[#f3f6f8]" : "hover:bg-neutral-50"}`}>
                    <span className="min-w-28">
                      <strong className="block text-[11px] num-fa">{order.orderCode}</strong>
                      <small className="text-[9px] text-neutral-400">{when(order.updatedAt)}</small>
                    </span>
                    <span className="min-w-32 flex-1 text-[10.5px]">
                      <b className="block font-medium">{order.storeName}</b>
                      <span className="text-neutral-400">{order.supplierNames || "بدون تأمین‌کننده"}</span>
                    </span>
                    <span className="text-[10.5px] num-fa">{toman(order.totalAmount)}</span>
                    <span className="border border-neutral-200 px-2 py-1 text-[9px]">{ORDER_STATUS_LABEL[order.status] ?? order.status}</span>
                    <span className="border border-neutral-200 px-2 py-1 text-[9px]">{FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus}</span>
                    <span className={`px-2 py-1 text-[9px] ${order.operationalPriority >= 80 ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-500"}`}>{priorityLabel(order.operationalPriority)}</span>
                  </button>
                ))}
                {!group.items.length && <p className="px-4 py-8 text-center text-[10.5px] text-neutral-400">سفارشی در این دسته نیست.</p>}
              </div>
            </section>
          ))}
        </div>
        <aside className="border border-neutral-200 bg-white p-5 xl:sticky xl:top-36 xl:self-start">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[9px] text-neutral-400">ORDER DETAIL</p>
                  <h2 className="mt-1 text-[16px] font-medium num-fa">{selected.orderCode}</h2>
                  <p className="mt-1 text-[10px] text-neutral-500">{selected.storeName} · {selected.buyerCity || "—"} · {selected.buyerPhone || "—"}</p>
                </div>
                <button type="button" aria-label="بستن جزئیات" onClick={() => setSelectedId(null)} className={`h-9 w-9 border ${focusRing}`}><Icon name="close" className="mx-auto h-4 w-4" /></button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
                {[
                  ["وضعیت", ORDER_STATUS_LABEL[selected.status] ?? selected.status],
                  ["پرداخت", PAYMENT_STATUS_LABEL[selected.paymentStatus] ?? selected.paymentStatus],
                  ["آماده‌سازی", FULFILLMENT_STATUS_LABEL[selected.fulfillmentStatus] ?? selected.fulfillmentStatus],
                  ["اولویت", `${priorityLabel(selected.operationalPriority)} (${fa(selected.operationalPriority)})`],
                  ["ثبت", when(selected.createdAt)],
                  ["آخرین تغییر", when(selected.updatedAt)],
                  ["ارسال", when(selected.shippedAt)],
                  ["مبلغ", toman(selected.totalAmount)],
                ].map(([label, value]) => <div key={label} className="bg-[#f6f6f4] p-2"><dt className="text-neutral-400">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
              </dl>
              <div className="mt-4 space-y-2">
                <label className="block text-[9.5px] text-neutral-500">وضعیت آماده‌سازی / ارسال
                  <select aria-label="تغییر وضعیت آماده‌سازی" disabled={busy} value={selected.fulfillmentStatus} onChange={(event) => saveOps({ fulfillmentStatus: event.target.value })} className={`${field} mt-1 w-full`}>
                    {Object.entries(FULFILLMENT_STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
                <label className="block text-[9.5px] text-neutral-500">وضعیت پرداخت
                  <select aria-label="تغییر وضعیت پرداخت" disabled={busy} value={selected.paymentStatus} onChange={(event) => saveOps({ paymentStatus: event.target.value })} className={`${field} mt-1 w-full`}>
                    {Object.entries(PAYMENT_STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
                <label className="block text-[9.5px] text-neutral-500">اولویت عملیاتی
                  <select aria-label="تغییر اولویت عملیاتی" disabled={busy} value={String(selected.operationalPriority >= 80 ? 100 : selected.operationalPriority >= 40 ? 50 : 0)} onChange={(event) => saveOps({ operationalPriority: Number(event.target.value) })} className={`${field} mt-1 w-full`}>
                    <option value="0">عادی</option>
                    <option value="50">بالا</option>
                    <option value="100">فوری</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" disabled={busy || selected.status !== "pending"} onClick={() => act("approve")} className={`h-9 bg-[#011c3a] px-3 text-[10px] text-white disabled:opacity-40 ${focusRing}`}>تأیید سفارش</button>
                <button type="button" disabled={busy || selected.status === "cancelled" || selected.status === "fulfilled"} onClick={() => act("cancel")} className={`h-9 border border-red-200 px-3 text-[10px] text-red-700 disabled:opacity-40 ${focusRing}`}>لغو سفارش</button>
              </div>
              <div className="mt-4 max-h-52 overflow-y-auto border-t pt-3">
                <p className="text-[10px] font-medium">اقلام</p>
                {selected.items.map((item) => (
                  <div key={`${item.sku}-${item.size}`} className="mt-2 text-[9.5px]">
                    <b>{item.productName}</b>
                    <p className="text-neutral-400">{item.supplierName || "—"} · {item.sku} · {item.color || "—"} · سایز {item.size || "—"} · {fa(item.quantity)} × {toman(item.unitPrice)}</p>
                  </div>
                ))}
                <p className="mt-3 text-[10px] font-medium">سفارش‌های تأمین</p>
                {selected.purchaseOrders.map((po) => (
                  <div key={po.id} className="mt-2 text-[9.5px]">
                    <b className="num-fa">{po.orderCode}</b>
                    <p className="text-neutral-400">{po.supplierName} · {po.status} · {po.trackingCode || "بدون رهگیری"} · ارسال {when(po.shippedAt)}</p>
                  </div>
                ))}
                {!selected.purchaseOrders.length && <p className="mt-1 text-[9.5px] text-neutral-400">هنوز سفارش تأمینی ساخته نشده است.</p>}
              </div>
            </>
          ) : <p className="py-12 text-center text-[11px] text-neutral-400">سفارشی را از فهرست انتخاب کنید تا جزئیات کامل و تغییر وضعیت در دسترس باشد.</p>}
        </aside>
      </div>
    </section>
  );
}
