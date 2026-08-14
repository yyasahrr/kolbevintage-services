import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { Field, GhostButton, Modal, Select, SubmitButton, TextArea, TextInput } from "../components/form";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { formatMoney, formatMoneyCompact, formatNumber } from "../lib/format";
import { useDashboard } from "../state";
import type { Product } from "../domain/types";

type Draft = {
  name: string;
  sku: string;
  catalogueId: string;
  supplierId: string;
  unitPrice: string;
  moq: string;
  stock: string;
  status: Product["status"];
  image: string;
  description: string;
};

const EMPTY: Draft = {
  name: "",
  sku: "",
  catalogueId: "",
  supplierId: "",
  unitPrice: "",
  moq: "24",
  stock: "0",
  status: "active",
  image: "/images/flat.jpg",
  description: "",
};

const IMAGE_CHOICES = [
  "/images/flat.jpg",
  "/images/model-front.jpg",
  "/images/model-full.jpg",
  "/images/model-teal.jpg",
  "/images/detail-collar.jpg",
  "/images/detail-hem.jpg",
];

const STATUS_LABEL: Record<Product["status"], string> = {
  active: "فعال",
  draft: "پیش‌نویس",
  discontinued: "بایگانی",
};
const STATUS_TONE = { active: "success", draft: "warning", discontinued: "neutral" } as const;

function toDraft(p: Product): Draft {
  return {
    name: p.name,
    sku: p.sku,
    catalogueId: p.catalogueId,
    supplierId: p.supplierId,
    unitPrice: String(p.unitPrice),
    moq: String(p.moq),
    stock: String(p.stock),
    status: p.status,
    image: p.image ?? IMAGE_CHOICES[0],
    description: p.description ?? "",
  };
}

export function ProductsPage() {
  const { data, dispatch } = useDashboard();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogueFilter, setCatalogueFilter] = useState("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.products.filter((p) => {
      if (catalogueFilter !== "all" && p.catalogueId !== catalogueFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [data.products, query, catalogueFilter]);

  const totalStock = data.products.reduce((s, p) => s + p.stock, 0);
  const activeCount = data.products.filter((p) => p.status === "active").length;
  const outOfStock = data.products.filter((p) => p.stock === 0 && p.status === "active").length;
  const avgPrice = data.products.length
    ? data.products.reduce((s, p) => s + p.unitPrice, 0) / data.products.length
    : 0;

  const priceNum = Number(draft.unitPrice);
  const errors = {
    name: !draft.name.trim() ? "نام محصول الزامی است" : undefined,
    sku: !draft.sku.trim() ? "کد SKU الزامی است" : undefined,
    catalogueId: !draft.catalogueId ? "انتخاب کاتالوگ الزامی است" : undefined,
    supplierId: !draft.supplierId ? "انتخاب تأمین‌کننده الزامی است" : undefined,
    unitPrice: !draft.unitPrice || Number.isNaN(priceNum) || priceNum <= 0 ? "قیمت باید عددی مثبت باشد" : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const openCreate = () => {
    setDraft({ ...EMPTY, catalogueId: data.catalogues[0]?.id ?? "", supplierId: data.suppliers[0]?.id ?? "" });
    setTouched(false);
    setCreating(true);
  };

  const openEdit = (p: Product) => {
    setDraft(toDraft(p));
    setTouched(false);
    setEditing(p);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const payload = {
      name: draft.name.trim(),
      sku: draft.sku.trim(),
      catalogueId: draft.catalogueId,
      supplierId: draft.supplierId,
      category: data.catalogues.find((c) => c.id === draft.catalogueId)?.category ?? "general",
      unitPrice: Number(draft.unitPrice),
      moq: Number(draft.moq) || 1,
      stock: Number(draft.stock) || 0,
      status: draft.status,
      image: draft.image,
      description: draft.description.trim(),
    };
    if (editing) dispatch({ type: "product/update", productId: editing.id, patch: payload });
    else dispatch({ type: "product/create", product: payload });
    close();
  };

  const columns: Array<Column<Product>> = [
    {
      key: "name",
      header: "محصول",
      value: (p) => p.name,
      render: (p) => (
        <span className="flex items-center gap-2">
          {p.image ? (
            <img src={p.image} alt="" className="size-8 shrink-0 rounded-lg object-cover" loading="lazy" />
          ) : null}
          <span className="min-w-0 truncate">{p.name}</span>
        </span>
      ),
    },
    { key: "sku", header: "SKU", value: (p) => p.sku, secondary: true },
    {
      key: "catalogue",
      header: "کاتالوگ",
      value: (p) => data.catalogues.find((c) => c.id === p.catalogueId)?.name ?? "—",
    },
    {
      key: "supplier",
      header: "تأمین‌کننده",
      value: (p) => data.suppliers.find((s) => s.id === p.supplierId)?.name ?? "—",
      secondary: true,
    },
    { key: "price", header: "قیمت عمده", value: (p) => p.unitPrice, align: "end", render: (p) => <MoneyValue amount={p.unitPrice} /> },
    { key: "moq", header: "حداقل سفارش", value: (p) => p.moq, align: "end" },
    {
      key: "stock",
      header: "موجودی",
      value: (p) => p.stock,
      align: "end",
      render: (p) => (
        <span className={cn("tabular-nums", p.stock === 0 && "text-rose-600 dark:text-rose-400")}>
          {formatNumber(p.stock)}
        </span>
      ),
    },
    {
      key: "status",
      header: "وضعیت",
      value: (p) => p.status,
      render: (p) => <StatusBadge label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} />,
    },
    {
      key: "actions",
      header: "اقدام",
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <ActionButton onClick={() => openEdit(p)} testId={`edit-${p.id}`}>
            ویرایش
          </ActionButton>
          <ActionButton
            variant="danger"
            testId={`delete-${p.id}`}
            onClick={() => dispatch({ type: "product/delete", productId: p.id })}
          >
            حذف
          </ActionButton>
        </div>
      ),
    },
  ];

  const form = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="نام محصول" required error={touched ? errors.name : undefined}>
        <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} invalid={touched && !!errors.name} testId="product-name" />
      </Field>
      <Field label="کد SKU" required error={touched ? errors.sku : undefined}>
        <TextInput value={draft.sku} onChange={(v) => setDraft({ ...draft, sku: v })} invalid={touched && !!errors.sku} testId="product-sku" />
      </Field>
      <Field label="کاتالوگ" required error={touched ? errors.catalogueId : undefined}>
        <Select
          value={draft.catalogueId}
          onChange={(v) => setDraft({ ...draft, catalogueId: v })}
          placeholder="انتخاب کنید…"
          options={data.catalogues.map((c) => ({ value: c.id, label: c.name }))}
          testId="product-catalogue"
        />
      </Field>
      <Field label="تأمین‌کننده" required error={touched ? errors.supplierId : undefined} hint="مشتری هرگز این اطلاعات را نمی‌بیند">
        <Select
          value={draft.supplierId}
          onChange={(v) => setDraft({ ...draft, supplierId: v })}
          placeholder="انتخاب کنید…"
          options={data.suppliers.map((s) => ({ value: s.id, label: s.name }))}
          testId="product-supplier"
        />
      </Field>
      <Field label="قیمت عمده (تومان)" required error={touched ? errors.unitPrice : undefined}>
        <TextInput
          value={draft.unitPrice}
          onChange={(v) => setDraft({ ...draft, unitPrice: v.replace(/[^\d]/g, "") })}
          inputMode="numeric"
          invalid={touched && !!errors.unitPrice}
          testId="product-price"
        />
      </Field>
      <Field label="حداقل سفارش (MOQ)">
        <TextInput value={draft.moq} onChange={(v) => setDraft({ ...draft, moq: v.replace(/[^\d]/g, "") })} inputMode="numeric" />
      </Field>
      <Field label="موجودی">
        <TextInput value={draft.stock} onChange={(v) => setDraft({ ...draft, stock: v.replace(/[^\d]/g, "") })} inputMode="numeric" />
      </Field>
      <Field label="وضعیت">
        <Select
          value={draft.status}
          onChange={(v) => setDraft({ ...draft, status: v as Product["status"] })}
          options={[
            { value: "active", label: "فعال" },
            { value: "draft", label: "پیش‌نویس" },
            { value: "discontinued", label: "بایگانی" },
          ]}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="تصویر">
          <div className="flex flex-wrap gap-2">
            {IMAGE_CHOICES.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setDraft({ ...draft, image: src })}
                aria-label={`انتخاب تصویر ${src}`}
                aria-pressed={draft.image === src}
                className={cn(
                  "overflow-hidden rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
                  draft.image === src ? "border-navy dark:border-sky-400" : "border-transparent opacity-70 hover:opacity-100",
                )}
              >
                <img src={src} alt="" className="size-14 object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="توضیحات">
          <TextArea value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
        </Field>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="محصولاتی که در کاتالوگ عمده به مشتریان VIP عرضه می‌شوند">مدیریت محصولات</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="کل محصولات" value={formatNumber(data.products.length)} tone="info" />
          <MetricCard label="فعال" value={formatNumber(activeCount)} tone="success" />
          <MetricCard label="ناموجود" value={formatNumber(outOfStock)} tone="danger" />
          <MetricCard label="میانگین قیمت" value={formatMoneyCompact(avgPrice)} hint={`موجودی کل: ${formatNumber(totalStock)}`} tone="progress" />
        </div>
      </section>

      <Card>
        <CardHeader
          title="فهرست محصولات"
          subtitle={`${rows.length} محصول`}
          action={
            <SubmitButton onClick={openCreate} testId="new-product">
              + محصول جدید
            </SubmitButton>
          }
        />
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 sm:flex-row dark:border-slate-800">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی نام یا SKU…"
            aria-label="جستجوی محصول"
            data-testid="product-search"
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:max-w-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <select
            value={catalogueFilter}
            onChange={(e) => setCatalogueFilter(e.target.value)}
            aria-label="فیلتر کاتالوگ"
            data-testid="product-catalogue-filter"
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:max-w-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">همه کاتالوگ‌ها</option>
            {data.catalogues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          pageSize={12}
          testId="products-admin-table"
          emptyTitle="محصولی یافت نشد"
          mobileCard={(p) => (
            <div className="flex items-center gap-3 text-xs">
              {p.image ? <img src={p.image} alt="" className="size-12 rounded-lg object-cover" loading="lazy" /> : null}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                <span className="text-slate-500">{formatMoney(p.unitPrice)}</span>
                <StatusBadge label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} />
              </div>
            </div>
          )}
        />
      </Card>

      {creating || editing ? (
        <Modal
          title={editing ? `ویرایش ${editing.name}` : "محصول جدید"}
          subtitle="قیمت عمده و حداقل سفارش برای مشتریان VIP اعمال می‌شود"
          onClose={close}
          testId="product-modal"
          wide
          footer={
            <>
              <SubmitButton onClick={save} testId="save-product">
                {editing ? "ذخیره تغییرات" : "ایجاد محصول"}
              </SubmitButton>
              <GhostButton onClick={close}>انصراف</GhostButton>
            </>
          }
        >
          {form}
        </Modal>
      ) : null}
    </div>
  );
}
