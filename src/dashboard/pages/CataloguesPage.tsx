import { useMemo, useState } from "react";
import { ActionButton } from "../components/ActionButton";
import { Field, GhostButton, Modal, Select, SubmitButton, TextArea, TextInput } from "../components/form";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { formatCompactNumber, formatNumber } from "../lib/format";
import { useDashboard } from "../state";
import type { Catalogue } from "../domain/types";

type Draft = {
  name: string;
  season: string;
  category: string;
  status: Catalogue["status"];
  coverImage: string;
  description: string;
};

const EMPTY: Draft = {
  name: "",
  season: "",
  category: "",
  status: "draft",
  coverImage: "/images/banner.jpg",
  description: "",
};

const COVERS = ["/images/banner.jpg", "/images/store.jpg", "/images/model-full.jpg", "/images/model-teal.jpg"];

const STATUS_LABEL: Record<Catalogue["status"], string> = {
  active: "منتشرشده",
  draft: "پیش‌نویس",
  archived: "بایگانی",
};
const STATUS_TONE = { active: "success", draft: "warning", archived: "neutral" } as const;

export function CataloguesPage({ onOpenProducts }: { onOpenProducts: (catalogueId: string) => void }) {
  const { data, dispatch } = useDashboard();
  const [editing, setEditing] = useState<Catalogue | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState(false);

  const stats = useMemo(() => {
    const productCount = new Map<string, number>();
    const value = new Map<string, number>();
    for (const p of data.products) {
      productCount.set(p.catalogueId, (productCount.get(p.catalogueId) ?? 0) + 1);
      value.set(p.catalogueId, (value.get(p.catalogueId) ?? 0) + p.unitPrice * p.stock);
    }
    return { productCount, value };
  }, [data.products]);

  const errors = {
    name: !draft.name.trim() ? "نام کاتالوگ الزامی است" : undefined,
    category: !draft.category.trim() ? "دسته الزامی است" : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const openCreate = () => {
    setDraft(EMPTY);
    setTouched(false);
    setCreating(true);
  };

  const openEdit = (c: Catalogue) => {
    setDraft({
      name: c.name,
      season: c.season,
      category: c.category,
      status: c.status,
      coverImage: c.coverImage ?? COVERS[0],
      description: c.description ?? "",
    });
    setTouched(false);
    setEditing(c);
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
      season: draft.season.trim() || "چهارفصل",
      category: draft.category.trim(),
      status: draft.status,
      coverImage: draft.coverImage,
      description: draft.description.trim(),
    };
    if (editing) dispatch({ type: "catalogue/update", catalogueId: editing.id, patch: payload });
    else dispatch({ type: "catalogue/create", catalogue: payload });
    close();
  };

  const activeCount = data.catalogues.filter((c) => c.status === "active").length;
  const totalViews = data.catalogues.reduce((s, c) => s + c.views, 0);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="کاتالوگ‌ها گروه‌بندی محصولات برای عرضه به مشتریان VIP هستند">مدیریت کاتالوگ‌ها</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="کل کاتالوگ‌ها" value={formatNumber(data.catalogues.length)} tone="info" />
          <MetricCard label="منتشرشده" value={formatNumber(activeCount)} tone="success" />
          <MetricCard label="کل محصولات" value={formatNumber(data.products.length)} tone="progress" />
          <MetricCard label="کل بازدید" value={formatCompactNumber(totalViews)} tone="warning" />
        </div>
      </section>

      <Card>
        <CardHeader
          title="کاتالوگ‌ها"
          subtitle={`${data.catalogues.length} کاتالوگ`}
          action={
            <SubmitButton onClick={openCreate} testId="new-catalogue">
              + کاتالوگ جدید
            </SubmitButton>
          }
        />
        <ul className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3" data-testid="catalogues-grid">
          {data.catalogues.map((c) => (
            <li
              key={c.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800"
            >
              {c.coverImage ? (
                <img src={c.coverImage} alt="" className="h-28 w-full object-cover" loading="lazy" />
              ) : null}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.name}</h3>
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {c.season} · {c.category}
                    </p>
                  </div>
                  <StatusBadge label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
                </div>

                <dl className="grid grid-cols-3 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <div>
                    <dt>محصولات</dt>
                    <dd className="tabular-nums text-slate-800 dark:text-slate-100">
                      {formatNumber(stats.productCount.get(c.id) ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>بازدید</dt>
                    <dd className="tabular-nums text-slate-800 dark:text-slate-100">{formatCompactNumber(c.views)}</dd>
                  </div>
                  <div>
                    <dt>ارزش انبار</dt>
                    <dd className="text-slate-800 dark:text-slate-100">
                      <MoneyValue amount={stats.value.get(c.id) ?? 0} compact />
                    </dd>
                  </div>
                </dl>

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
                  <ActionButton onClick={() => openEdit(c)} testId={`edit-cat-${c.id}`}>
                    ویرایش
                  </ActionButton>
                  <ActionButton onClick={() => onOpenProducts(c.id)}>محصولات</ActionButton>
                  {c.status === "active" ? (
                    <ActionButton onClick={() => dispatch({ type: "catalogue/update", catalogueId: c.id, patch: { status: "archived" } })}>
                      بایگانی
                    </ActionButton>
                  ) : (
                    <ActionButton
                      variant="primary"
                      testId={`publish-${c.id}`}
                      onClick={() => dispatch({ type: "catalogue/update", catalogueId: c.id, patch: { status: "active" } })}
                    >
                      انتشار
                    </ActionButton>
                  )}
                  <ActionButton
                    variant="danger"
                    testId={`delete-cat-${c.id}`}
                    onClick={() => dispatch({ type: "catalogue/delete", catalogueId: c.id })}
                  >
                    حذف
                  </ActionButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {creating || editing ? (
        <Modal
          title={editing ? `ویرایش ${editing.name}` : "کاتالوگ جدید"}
          onClose={close}
          testId="catalogue-modal"
          footer={
            <>
              <SubmitButton onClick={save} testId="save-catalogue">
                {editing ? "ذخیره تغییرات" : "ایجاد کاتالوگ"}
              </SubmitButton>
              <GhostButton onClick={close}>انصراف</GhostButton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="نام کاتالوگ" required error={touched ? errors.name : undefined}>
              <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} invalid={touched && !!errors.name} testId="catalogue-name" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="فصل">
                <TextInput value={draft.season} onChange={(v) => setDraft({ ...draft, season: v })} placeholder="مثلاً پاییز ۱۴۰۵" />
              </Field>
              <Field label="دسته" required error={touched ? errors.category : undefined}>
                <TextInput value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} invalid={touched && !!errors.category} testId="catalogue-category" />
              </Field>
            </div>
            <Field label="وضعیت">
              <Select
                value={draft.status}
                onChange={(v) => setDraft({ ...draft, status: v as Catalogue["status"] })}
                options={[
                  { value: "draft", label: "پیش‌نویس" },
                  { value: "active", label: "منتشرشده" },
                  { value: "archived", label: "بایگانی" },
                ]}
              />
            </Field>
            <Field label="تصویر جلد">
              <div className="flex flex-wrap gap-2">
                {COVERS.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setDraft({ ...draft, coverImage: src })}
                    aria-label={`انتخاب جلد ${src}`}
                    aria-pressed={draft.coverImage === src}
                    className={
                      draft.coverImage === src
                        ? "overflow-hidden rounded-lg border-2 border-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-sky-400"
                        : "overflow-hidden rounded-lg border-2 border-transparent opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    }
                  >
                    <img src={src} alt="" className="h-12 w-20 object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="توضیحات">
              <TextArea value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
