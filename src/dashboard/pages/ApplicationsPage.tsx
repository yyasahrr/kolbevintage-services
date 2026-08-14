import { useMemo, useState } from "react";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { Field, GhostButton, Modal, Select, SubmitButton, TextArea, TextInput } from "../components/form";
import { Card, CardHeader, MetricCard, SectionTitle, StatusBadge } from "../components/primitives";
import { formatDateDual, formatNumber } from "../lib/format";
import { useDashboard } from "../state";
import type { ApplicationStatus, SupplierApplication } from "../domain/types";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "در انتظار بررسی",
  in_review: "در حال بررسی",
  approved: "تأیید شده",
  rejected: "رد شده",
};
const STATUS_TONE = { pending: "warning", in_review: "progress", approved: "success", rejected: "danger" } as const;

export function ApplicationsPage({ onOpenSuppliers }: { onOpenSuppliers: () => void }) {
  const { data, dispatch } = useDashboard();
  const [detail, setDetail] = useState<SupplierApplication | null>(null);
  const [rejecting, setRejecting] = useState<SupplierApplication | null>(null);
  const [reason, setReason] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ name: "", city: "", specialty: "", commissionTier: "10" });
  const [touched, setTouched] = useState(false);

  const sorted = useMemo(
    () => [...data.applications].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [data.applications],
  );

  const pending = data.applications.filter((a) => a.status === "pending").length;
  const inReview = data.applications.filter((a) => a.status === "in_review").length;
  const approved = data.applications.filter((a) => a.status === "approved").length;
  const rejected = data.applications.filter((a) => a.status === "rejected").length;

  const supplierErrors = {
    name: !supplierDraft.name.trim() ? "نام تأمین‌کننده الزامی است" : undefined,
    city: !supplierDraft.city.trim() ? "شهر الزامی است" : undefined,
    specialty: !supplierDraft.specialty.trim() ? "تخصص الزامی است" : undefined,
  };
  const supplierValid = Object.values(supplierErrors).every((e) => !e);

  const columns: Array<Column<SupplierApplication>> = [
    { key: "code", header: "کد", value: (a) => a.code },
    { key: "company", header: "شرکت", value: (a) => a.companyName },
    { key: "contact", header: "مسئول", value: (a) => a.contactName, secondary: true },
    { key: "city", header: "شهر", value: (a) => a.city },
    { key: "specialty", header: "تخصص", value: (a) => a.specialty, secondary: true },
    {
      key: "capacity",
      header: "ظرفیت ماهانه",
      value: (a) => a.monthlyCapacity,
      align: "end",
      render: (a) => formatNumber(a.monthlyCapacity),
    },
    { key: "submitted", header: "تاریخ ثبت", value: (a) => a.submittedAt, render: (a) => formatDateDual(a.submittedAt) },
    {
      key: "status",
      header: "وضعیت",
      value: (a) => a.status,
      render: (a) => <StatusBadge label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />,
    },
    {
      key: "actions",
      header: "اقدام",
      render: (a) => (
        <div className="flex items-center justify-end gap-1.5">
          <ActionButton onClick={() => setDetail(a)} testId={`view-${a.id}`}>
            جزئیات
          </ActionButton>
          {a.status === "pending" || a.status === "in_review" ? (
            <>
              <ActionButton
                variant="primary"
                testId={`approve-${a.id}`}
                onClick={() => dispatch({ type: "application/status", applicationId: a.id, status: "approved" })}
              >
                تأیید
              </ActionButton>
              <ActionButton
                variant="danger"
                testId={`reject-${a.id}`}
                onClick={() => {
                  setReason("");
                  setRejecting(a);
                }}
              >
                رد
              </ActionButton>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="تأمین‌کنندگان از فرم عمومی #/supplier-apply درخواست می‌دهند">
          درخواست‌های همکاری
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="در انتظار بررسی" value={formatNumber(pending)} tone="warning" />
          <MetricCard label="در حال بررسی" value={formatNumber(inReview)} tone="progress" />
          <MetricCard label="تأیید شده" value={formatNumber(approved)} tone="success" />
          <MetricCard label="رد شده" value={formatNumber(rejected)} tone="danger" />
        </div>
      </section>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-6 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
        لینک فرم عمومی برای تأمین‌کنندگان:{" "}
        <a href="#/supplier-apply" className="font-medium underline underline-offset-2" data-testid="apply-link">
          #/supplier-apply
        </a>{" "}
        — با تأیید هر درخواست، حساب تأمین‌کننده به‌صورت خودکار ساخته و به فهرست تأمین‌کنندگان اضافه می‌شود.
      </div>

      <Card>
        <CardHeader
          title="صف بررسی"
          subtitle={`${sorted.length} درخواست`}
          action={
            <SubmitButton onClick={() => { setSupplierDraft({ name: "", city: "", specialty: "", commissionTier: "10" }); setTouched(false); setAddingSupplier(true); }} testId="add-supplier-direct">
              + افزودن مستقیم تأمین‌کننده
            </SubmitButton>
          }
        />
        <DataTable
          rows={sorted}
          columns={columns}
          rowKey={(a) => a.id}
          pageSize={10}
          testId="applications-table"
          emptyTitle="درخواستی ثبت نشده است"
          mobileCard={(a) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{a.companyName}</span>
                <StatusBadge label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />
              </div>
              <span className="text-slate-500">
                {a.city} · {a.specialty}
              </span>
            </div>
          )}
        />
      </Card>

      {detail ? (
        <Modal
          title={detail.companyName}
          subtitle={`${detail.code} · ${STATUS_LABEL[detail.status]}`}
          onClose={() => setDetail(null)}
          testId="application-detail"
          footer={
            detail.status === "pending" || detail.status === "in_review" ? (
              <>
                <SubmitButton
                  onClick={() => {
                    dispatch({ type: "application/status", applicationId: detail.id, status: "approved" });
                    setDetail(null);
                  }}
                >
                  تأیید و ایجاد تأمین‌کننده
                </SubmitButton>
                <GhostButton
                  onClick={() => {
                    dispatch({ type: "application/status", applicationId: detail.id, status: "in_review" });
                    setDetail(null);
                  }}
                >
                  علامت‌گذاری در حال بررسی
                </GhostButton>
              </>
            ) : (
              <GhostButton onClick={() => setDetail(null)}>بستن</GhostButton>
            )
          }
        >
          <dl className="flex flex-col gap-2 text-sm">
            {[
              ["مسئول", detail.contactName],
              ["ایمیل", detail.email],
              ["تماس", detail.phone],
              ["شهر", detail.city],
              ["تخصص", detail.specialty],
              ["ظرفیت ماهانه", formatNumber(detail.monthlyCapacity)],
              ["سابقه", `${detail.yearsActive} سال`],
              ["وب‌سایت", detail.website ?? "—"],
              ["تاریخ ثبت", formatDateDual(detail.submittedAt)],
              ["بررسی‌کننده", detail.reviewedBy ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="min-w-0 truncate text-slate-800 dark:text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>
          {detail.note ? (
            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              {detail.note}
            </p>
          ) : null}
          {detail.rejectionReason ? (
            <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              دلیل رد: {detail.rejectionReason}
            </p>
          ) : null}
          {detail.createdSupplierId ? (
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                onOpenSuppliers();
              }}
              className="mt-3 text-xs text-navy underline underline-offset-2 dark:text-sky-400"
            >
              مشاهده در فهرست تأمین‌کنندگان ←
            </button>
          ) : null}
        </Modal>
      ) : null}

      {rejecting ? (
        <Modal
          title={`رد درخواست ${rejecting.code}`}
          onClose={() => setRejecting(null)}
          testId="reject-modal"
          footer={
            <>
              <SubmitButton
                testId="confirm-reject"
                onClick={() => {
                  dispatch({ type: "application/status", applicationId: rejecting.id, status: "rejected", reason });
                  setRejecting(null);
                }}
              >
                ثبت رد درخواست
              </SubmitButton>
              <GhostButton onClick={() => setRejecting(null)}>انصراف</GhostButton>
            </>
          }
        >
          <Field label="دلیل رد" hint="این متن در سوابق درخواست ذخیره می‌شود">
            <TextArea value={reason} onChange={setReason} rows={3} testId="reject-reason" />
          </Field>
        </Modal>
      ) : null}

      {addingSupplier ? (
        <Modal
          title="افزودن مستقیم تأمین‌کننده"
          subtitle="برای شرکایی که خارج از فرم عمومی جذب شده‌اند"
          onClose={() => setAddingSupplier(false)}
          testId="add-supplier-modal"
          footer={
            <>
              <SubmitButton
                testId="save-supplier"
                onClick={() => {
                  setTouched(true);
                  if (!supplierValid) return;
                  dispatch({
                    type: "supplier/create",
                    supplier: {
                      name: supplierDraft.name.trim(),
                      city: supplierDraft.city.trim(),
                      specialty: supplierDraft.specialty.trim(),
                      commissionTier: Math.min(12, Math.max(8, Number(supplierDraft.commissionTier) || 10)),
                    },
                  });
                  setAddingSupplier(false);
                }}
              >
                افزودن تأمین‌کننده
              </SubmitButton>
              <GhostButton onClick={() => setAddingSupplier(false)}>انصراف</GhostButton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="نام تأمین‌کننده" required error={touched ? supplierErrors.name : undefined}>
              <TextInput value={supplierDraft.name} onChange={(v) => setSupplierDraft({ ...supplierDraft, name: v })} invalid={touched && !!supplierErrors.name} testId="supplier-name" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="شهر" required error={touched ? supplierErrors.city : undefined}>
                <TextInput value={supplierDraft.city} onChange={(v) => setSupplierDraft({ ...supplierDraft, city: v })} invalid={touched && !!supplierErrors.city} />
              </Field>
              <Field label="تخصص" required error={touched ? supplierErrors.specialty : undefined}>
                <TextInput value={supplierDraft.specialty} onChange={(v) => setSupplierDraft({ ...supplierDraft, specialty: v })} invalid={touched && !!supplierErrors.specialty} />
              </Field>
            </div>
            <Field label="نرخ کمیسیون کلبه وینتیج" hint="بین ۸ تا ۱۲ درصد">
              <Select
                value={supplierDraft.commissionTier}
                onChange={(v) => setSupplierDraft({ ...supplierDraft, commissionTier: v })}
                options={[8, 9, 10, 11, 12].map((n) => ({ value: String(n), label: `${n}٪` }))}
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
