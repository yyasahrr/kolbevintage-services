import { useEffect, useState } from "react";
import { canonicalClient } from "../../shared/http/clients";

type Dashboard = {
  range: { preset?: string; startUtc?: string; endUtc?: string };
  sales: { ordersCount: string; unitsOrdered: string; orderedGmv: string; paidOrdersCount: string };
  operations: {
    awaitingPayment: number; fulfillmentBacklog: number; shipmentBacklog: number;
    returnsByStatus: Record<string, number>; refundsByStatus: Record<string, number>;
    flaggedReviews: number; inventory: { tracked: number; stockout: number };
  };
  exceptions: {
    payments: Array<{ id: string; orderCode: string; status: string; failureReason: string | null }>;
    shipments: Array<{ id: string; orderCode: string; status: string; failureReason: string | null }>;
  };
  generatedAt: string;
};

// The analytics contract reports IRR as an integer string; never round it through Number.
const number = (value: string | number) => new Intl.NumberFormat("fa-IR").format(typeof value === "string" ? BigInt(value) : value);
const money = (value: string) => `${number(value)} ریال`;

export default function AdminRetailDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    canonicalClient().request<Dashboard>("/admin/retail/dashboard", { query: { preset: "LAST_30_DAYS" }, signal: controller.signal })
      .then(setData)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "گزارش عملیاتی در دسترس نیست."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  return <main className="kolbe-ops-page" dir="rtl">
    <header className="kolbe-ops-heading"><p>ADMIN / RETAIL</p><h1>نمای عملیاتی خرده‌فروشی</h1><span>داده‌های ۳۰ روز گذشته و صف‌های زنده، مستقیم از سرویس مدیریت.</span></header>
    {error ? <section className="kolbe-ops-state" role="alert"><h2>دریافت گزارش انجام نشد</h2><p>{error}</p><button className="kolbe-button" type="button" onClick={() => setReload((value) => value + 1)}>تلاش دوباره</button></section> :
      loading ? <section className="kolbe-ops-state" role="status" aria-live="polite">در حال دریافت گزارش عملیاتی…</section> :
      data ? <>
        <section className="kolbe-ops-metrics" aria-label="فروش خرده در ۳۰ روز گذشته">
          <article><span>سفارش‌ها</span><strong>{number(data.sales.ordersCount)}</strong></article>
          <article><span>سفارش‌های پرداخت‌شده</span><strong>{number(data.sales.paidOrdersCount)}</strong></article>
          <article><span>تعداد کالا</span><strong>{number(data.sales.unitsOrdered)}</strong></article>
          <article><span>ارزش سفارش</span><strong>{money(data.sales.orderedGmv)}</strong></article>
        </section>
        <section className="kolbe-ops-section"><h2>صف‌های عملیاتی اکنون</h2><div className="kolbe-ops-metrics">
          <article><span>در انتظار پرداخت</span><strong>{number(data.operations.awaitingPayment)}</strong></article>
          <article><span>آماده‌سازی سفارش</span><strong>{number(data.operations.fulfillmentBacklog)}</strong></article>
          <article><span>ارسال‌های باز</span><strong>{number(data.operations.shipmentBacklog)}</strong></article>
          <article><span>موجودی ناموجود</span><strong>{number(data.operations.inventory.stockout)}</strong><small>از {number(data.operations.inventory.tracked)} ردیف موجودی کلبه</small></article>
        </div></section>
        <section className="kolbe-ops-section"><h2>موارد نیازمند بررسی</h2>
          {!data.exceptions.payments.length && !data.exceptions.shipments.length ? <p className="kolbe-ops-state">موردی در نمونهٔ اخیر ثبت نشده است.</p> : <div className="kolbe-ops-exceptions">
            {data.exceptions.payments.map((item) => <article key={`p-${item.id}`}><span>پرداخت · {item.orderCode}</span><strong>{item.status}</strong>{item.failureReason && <small>{item.failureReason}</small>}</article>)}
            {data.exceptions.shipments.map((item) => <article key={`s-${item.id}`}><span>ارسال · {item.orderCode}</span><strong>{item.status}</strong>{item.failureReason && <small>{item.failureReason}</small>}</article>)}
          </div>}
        </section>
        <p className="kolbe-ops-footnote">آخرین تولید گزارش: {new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.generatedAt))}</p>
      </> : null}
  </main>;
}
