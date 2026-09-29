import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { fa, toman } from "../utils/format";
import {
  FULFILLMENT_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  WHOLESALE_ORDER_SORTS,
  approveWholesaleOrder,
  cancelWholesaleOrder,
  listWholesaleFulfillmentOrders,
  type AdminWholesaleOrder,
} from "../lib/wholesaleApi";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";

function when(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function WholesaleOrdersBoard({ onChanged }: { onChanged?: () => void }) {
  const [sort, setSort] = useState("newest");
  const [orders, setOrders] = useState<AdminWholesaleOrder[]>([]);
  const [selected, setSelected] = useState<AdminWholesaleOrder | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = (nextSort = sort) => {
    setLoading(true);
    setError("");
    return listWholesaleFulfillmentOrders({ sort: nextSort })
      .then((next) => {
        setOrders(next);
        setSelected((current) => next.find((order) => order.id === current?.id) ?? current);
      })
      .catch(() => setError("فهرست سفارش‌ها از سرور خوانده نشد."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(sort); }, [sort]);

  const act = async (action: "approve" | "cancel") => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      if (action === "approve") await approveWholesaleOrder(selected.id);
      else await cancelWholesaleOrder(selected.id);
      setNotice(action === "approve" ? "سفارش تأیید و برای تأمین‌کننده‌ها تفکیک شد." : "سفارش لغو و رزرو موجودی آزاد شد.");
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تغییر وضعیت انجام نشد.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="mb-5">
        <p className="text-[9px] tracking-[0.22em] text-neutral-400">BULK ORDERS</p>
        <h1 className="mt-2 text-[20px] font-medium tracking-tight">سفارش‌های عمده</h1>
        <p className="mt-1.5 max-w-3xl text-[10.5px] leading-6 text-neutral-500">ترتیب فهرست از سرور و بر اساس معیار انتخاب‌شده است؛ دریافت بدون ترتیب یا ترتیب تصادفی نمایش داده نمی‌شود.</p>
      </header>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-[10px] text-neutral-500">مرتب‌سازی
          <select aria-label="مرتب‌سازی سفارش‌های عمده" value={sort} onChange={(event) => setSort(event.target.value)} className={`mr-2 h-10 border border-neutral-300 bg-white px-3 text-[11px] ${focusRing}`}>
            {WHOLESALE_ORDER_SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <span className="text-[10px] text-neutral-400 num-fa">{loading ? "در حال خواندن…" : `${fa(orders.length)} سفارش`}</span>
      </div>
      {error && <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-3 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">{notice}</p>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-x-auto border border-neutral-200 bg-white">
          <table className="w-full min-w-[920px] text-right text-[10.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>{["کد", "خریدار", "تأمین‌کننده", "مبلغ", "پرداخت", "آماده‌سازی", "وضعیت", ""].map((head) => <th key={head} className="border-b p-3 font-medium">{head}</th>)}</tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="p-3 font-medium num-fa">{order.orderCode}<span className="mt-1 block text-[9px] font-normal text-neutral-400">{when(order.createdAt)}</span></td>
                  <td className="p-3">{order.storeName}</td>
                  <td className="p-3">{order.supplierNames || "—"}</td>
                  <td className="p-3 num-fa">{toman(order.totalAmount)}</td>
                  <td className="p-3">{PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}</td>
                  <td className="p-3">{FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus}</td>
                  <td className="p-3">{ORDER_STATUS_LABEL[order.status] ?? order.status}</td>
                  <td className="p-3 text-left"><button type="button" onClick={() => setSelected(order)} className={`underline underline-offset-4 ${focusRing}`}>جزئیات</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!orders.length && !loading && <p className="px-5 py-12 text-center text-[11px] text-neutral-400">سفارش عمده‌ای با این ترتیب ثبت نشده است.</p>}
        </div>
        <aside className="border border-neutral-200 bg-white p-5 xl:sticky xl:top-36 xl:self-start">
          {selected ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[9px] text-neutral-400">ORDER DETAIL</p>
                  <h2 className="mt-2 text-[15px] font-medium num-fa">{selected.orderCode}</h2>
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label="بستن جزئیات" className={`h-9 w-9 border border-neutral-200 ${focusRing}`}><Icon name="close" className="mx-auto h-4 w-4" /></button>
              </div>
              <dl className="mt-4 divide-y text-[10.5px]">
                {[
                  ["خریدار", `${selected.storeName}${selected.memberName ? ` · ${selected.memberName}` : ""}`],
                  ["شهر", selected.buyerCity || "—"],
                  ["تأمین‌کننده", selected.supplierNames || "—"],
                  ["مبلغ", toman(selected.totalAmount)],
                  ["تعداد", `${fa(selected.totalUnits)} عدد`],
                  ["وضعیت سفارش", ORDER_STATUS_LABEL[selected.status] ?? selected.status],
                  ["پرداخت", PAYMENT_STATUS_LABEL[selected.paymentStatus] ?? selected.paymentStatus],
                  ["آماده‌سازی", FULFILLMENT_STATUS_LABEL[selected.fulfillmentStatus] ?? selected.fulfillmentStatus],
                  ["آخرین تغییر", when(selected.updatedAt)],
                  ["زمان ارسال", when(selected.shippedAt)],
                ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-2.5"><dt className="text-neutral-400">{label}</dt><dd className="text-left">{value}</dd></div>)}
              </dl>
              <div className="mt-3 max-h-48 overflow-y-auto border-y">
                {selected.items.map((item) => (
                  <div key={`${item.sku}-${item.productName}`} className="py-2.5 text-[9.5px]">
                    <p className="font-medium">{item.productName}</p>
                    <p className="mt-1 text-neutral-400">{item.sku} · {item.color || "—"} · {item.size || "—"} · {fa(item.quantity)} · {item.supplierName || "—"}</p>
                  </div>
                ))}
                {!selected.items.length && <p className="py-3 text-[9.5px] text-neutral-400">ردیفی برای این سفارش ذخیره نشده است.</p>}
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" disabled={busy || selected.status !== "pending"} onClick={() => act("approve")} className={`h-9 bg-[#011c3a] px-3 text-[10px] text-white disabled:opacity-40 ${focusRing}`}>تأیید و تفکیک</button>
                <button type="button" disabled={busy || selected.status === "cancelled" || selected.status === "fulfilled"} onClick={() => act("cancel")} className={`h-9 border border-red-200 px-3 text-[10px] text-red-700 disabled:opacity-40 ${focusRing}`}>لغو</button>
              </div>
            </>
          ) : <p className="py-10 text-center text-[11px] text-neutral-400">یک سفارش را انتخاب کنید تا جزئیات کامل همین‌جا باز شود.</p>}
        </aside>
      </div>
    </section>
  );
}
