import { useEffect } from "react";
import { cn } from "@/utils/cn";
import {
  ACTOR_LABEL,
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  ESCROW_STATUS_LABEL,
  ESCROW_STATUS_TONE,
  FULFILLMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_TONE,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "../domain/labels";
import { formatDateTimeDual, formatDurationHours, formatMoney, formatNumber } from "../lib/format";
import type { DatasetIndex } from "../domain/selectors";
import type { WholesaleDataset } from "../domain/types";
import { MoneyValue, StatusBadge } from "./primitives";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-5 py-4 last:border-0 dark:border-slate-800">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

export function OrderDetailDrawer({
  orderId,
  data,
  index,
  now,
  onClose,
}: {
  orderId: string | null;
  data: WholesaleDataset;
  index: DatasetIndex;
  now: number;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderId, onClose]);

  if (!orderId) return null;
  const order = index.orderById.get(orderId);
  if (!order) return null;

  const customer = index.customerById.get(order.customerId);
  const payment = data.payments.find((p) => p.orderId === order.id);
  const escrow = index.escrowByOrder.get(order.id);
  const fulfillments = index.fulfillmentsByOrder.get(order.id) ?? [];
  const shipments = index.shipmentsByOrder.get(order.id) ?? [];
  const disputes = index.disputesByOrder.get(order.id) ?? [];
  const settlements = index.settlementsByOrder.get(order.id) ?? [];
  const timeline = data.timeline.filter((t) => t.orderId === order.id);
  const supplierPayable = settlements.reduce((s, x) => s + x.payableAmount, 0);
  const commissionTotal = settlements.reduce((s, x) => s + x.commissionAmount, 0);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={`جزئیات سفارش ${order.code}`}>
      <button type="button" aria-label="بستن جزئیات" onClick={onClose} className="flex-1 bg-slate-900/40 backdrop-blur-sm" />
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
        data-testid="order-drawer"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">{order.code}</h2>
              <StatusBadge label={ORDER_STATUS_LABEL[order.status]} tone={ORDER_STATUS_TONE[order.status]} />
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {customer?.company} · {formatDateTimeDual(order.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <Section title="سفارش مشتری (رابطه: مشتری ↔ کلبه وینتیج)">
          <Row label="مشتری VIP" value={`${customer?.company} — ${customer?.name}`} />
          <Row label="کاتالوگ" value={index.catalogueById.get(order.catalogueId)?.name ?? "—"} />
          <Row label="تعداد اقلام" value={formatNumber(order.itemCount)} />
          <Row label="مبلغ کل سفارش" value={<MoneyValue amount={order.total} />} />
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            مشتری صرفاً با کلبه وینتیج طرف قرارداد است؛ تأمین‌کنندگان شرکای داخلی تأمین هستند و هرگز
            به مشتری نمایش داده نمی‌شوند.
          </p>
        </Section>

        <Section title="پرداخت و امانی">
          <Row label="روش پرداخت" value={payment?.method ?? "—"} />
          <Row label="کد تراکنش" value={payment?.reference ?? "—"} />
          <Row
            label="وضعیت امانی"
            value={
              escrow ? <StatusBadge label={ESCROW_STATUS_LABEL[escrow.status]} tone={ESCROW_STATUS_TONE[escrow.status]} /> : "—"
            }
          />
          <Row label="نگهداری‌شده" value={<MoneyValue amount={escrow?.amountHeld ?? 0} />} />
          <Row label="آزادشده" value={<MoneyValue amount={escrow?.amountReleased ?? 0} />} />
          <Row label="بازپرداخت" value={<MoneyValue amount={escrow?.amountRefunded ?? 0} />} />
        </Section>

        <Section title="اقلام سفارش">
          <ul className="flex flex-col gap-2">
            {order.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                  {index.productById.get(it.productId)?.name ?? it.productId}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                  {formatNumber(it.quantity)} × {formatMoney(it.unitPrice)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`درخواست‌های تأمین (${fulfillments.length}) — رابطه: کلبه وینتیج ↔ تأمین‌کننده`}>
          <ul className="flex flex-col gap-2">
            {fulfillments.map((f) => (
              <li key={f.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {index.supplierById.get(f.supplierId)?.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {f.delayed ? <StatusBadge label="تأخیر SLA" tone="danger" /> : null}
                    <StatusBadge label={FULFILLMENT_STATUS_LABEL[f.status]} tone={FULFILLMENT_STATUS_TONE[f.status]} />
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{f.code}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>ارزش مشتری: {formatMoney(f.customerValue)}</span>
                  <span>بهای تأمین: {formatMoney(f.supplierCostTotal)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="مرسولات">
          {shipments.length === 0 ? (
            <p className="text-xs text-slate-500">هنوز مرسوله‌ای ثبت نشده است.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shipments.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-700 dark:text-slate-200">
                    {s.carrier} · {s.trackingCode}
                  </span>
                  <StatusBadge label={SHIPMENT_STATUS_LABEL[s.status]} tone={SHIPMENT_STATUS_TONE[s.status]} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="بازرسی ۷۲ ساعته">
          {order.inspectionEndsAt ? (
            <>
              <Row label="تحویل" value={order.deliveredAt ? formatDateTimeDual(order.deliveredAt) : "—"} />
              <Row label="پایان بازرسی" value={formatDateTimeDual(order.inspectionEndsAt)} />
              <Row
                label="زمان باقی‌مانده"
                value={
                  new Date(order.inspectionEndsAt).getTime() > now
                    ? formatDurationHours((new Date(order.inspectionEndsAt).getTime() - now) / 3_600_000)
                    : "منقضی شده"
                }
              />
            </>
          ) : (
            <p className="text-xs text-slate-500">سفارش هنوز به مرحله بازرسی نرسیده است.</p>
          )}
        </Section>

        <Section title="اختلافات">
          {disputes.length === 0 ? (
            <p className="text-xs text-slate-500">اختلافی ثبت نشده است.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {disputes.map((d) => (
                <li key={d.id} className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs dark:border-rose-900 dark:bg-rose-950/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-rose-700 dark:text-rose-300">{d.reason}</span>
                    <StatusBadge label={DISPUTE_STATUS_LABEL[d.status]} tone={DISPUTE_STATUS_TONE[d.status]} />
                  </div>
                  <p className="mt-1 text-rose-600/80 dark:text-rose-300/80">
                    مبلغ مسدود: {formatMoney(d.amountFrozen)} · مسئول: {d.assignedAdmin}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="تسویه تأمین‌کنندگان">
          {settlements.length === 0 ? (
            <p className="text-xs text-slate-500">سفارش هنوز واجد شرایط تسویه نیست.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {settlements.map((s) => (
                  <li key={s.id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {index.supplierById.get(s.supplierId)?.name}
                      </span>
                      <StatusBadge label={SETTLEMENT_STATUS_LABEL[s.status]} tone={SETTLEMENT_STATUS_TONE[s.status]} />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <div className="flex justify-between"><dt>مبلغ تأمین‌شده</dt><dd className="tabular-nums">{formatMoney(s.fulfilledAmount)}</dd></div>
                      <div className="flex justify-between"><dt>کمیسیون کلبه</dt><dd className="tabular-nums">−{formatMoney(s.commissionAmount)}</dd></div>
                      <div className="flex justify-between"><dt>بازپرداخت</dt><dd className="tabular-nums">−{formatMoney(s.refundAmount)}</dd></div>
                      <div className="flex justify-between"><dt>تعدیل‌ها</dt><dd className="tabular-nums">−{formatMoney(s.adjustmentTotal)}</dd></div>
                    </dl>
                    <p className="mt-2 border-t border-slate-100 pt-2 text-xs font-medium text-slate-800 dark:border-slate-800 dark:text-slate-100">
                      قابل پرداخت: {formatMoney(s.payableAmount)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900">
                <Row label="مبلغ سفارش مشتری" value={<MoneyValue amount={order.total} />} />
                <Row label="کمیسیون کلبه وینتیج" value={<MoneyValue amount={commissionTotal} />} />
                <Row label="مجموع قابل پرداخت به تأمین‌کنندگان" value={<MoneyValue amount={supplierPayable} />} />
              </div>
            </>
          )}
        </Section>

        <Section title="خط زمانی رخدادها">
          <ol className="relative flex flex-col gap-4 pr-4">
            {timeline.map((t) => (
              <li key={t.id} className="relative">
                <span
                  className={cn(
                    "absolute -right-4 top-1.5 size-2 rounded-full",
                    t.actor === "customer"
                      ? "bg-sky-500"
                      : t.actor === "supplier"
                        ? "bg-indigo-500"
                        : t.actor === "finance"
                          ? "bg-emerald-500"
                          : t.actor === "system"
                            ? "bg-slate-400"
                            : "bg-navy dark:bg-sky-300",
                  )}
                  aria-hidden="true"
                />
                <div className="border-r border-slate-100 pr-4 dark:border-slate-800">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-slate-800 dark:text-slate-100">{t.label}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{formatDateTimeDual(t.at)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {ACTOR_LABEL[t.actor]}
                    {t.detail ? ` · ${t.detail}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
