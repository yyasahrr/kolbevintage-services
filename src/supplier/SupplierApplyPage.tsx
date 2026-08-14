import { useState } from "react";
import { Field, Select, SubmitButton, TextArea, TextInput } from "../dashboard/components/form";
import { applyAction } from "../dashboard/domain/actions";
import { generateDataset } from "../dashboard/domain/generate";
import { loadDataset, saveDataset } from "../dashboard/lib/persistence";

const SPECIALTIES = [
  "پارچه و بافت",
  "پوشاک زنانه",
  "پوشاک مردانه",
  "بافتنی",
  "جین و دنیم",
  "چرم",
  "کتان",
  "اکسسوری",
  "تولید انبوه",
];

interface Draft {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  specialty: string;
  monthlyCapacity: string;
  yearsActive: string;
  website: string;
  note: string;
}

const EMPTY: Draft = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  city: "",
  specialty: "",
  monthlyCapacity: "",
  yearsActive: "",
  website: "",
  note: "",
};

/**
 * Public partnership application. It writes into the same persisted dataset the
 * admin dashboard reads, so a submission shows up in the review queue — but it
 * renders completely outside the admin shell and exposes no internal data.
 */
export function SupplierApplyPage() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  const capacity = Number(draft.monthlyCapacity);
  const errors = {
    companyName: !draft.companyName.trim() ? "نام شرکت الزامی است" : undefined,
    contactName: !draft.contactName.trim() ? "نام مسئول الزامی است" : undefined,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email) ? "ایمیل معتبر وارد کنید" : undefined,
    phone: draft.phone.replace(/\D/g, "").length < 8 ? "شماره تماس معتبر وارد کنید" : undefined,
    city: !draft.city.trim() ? "شهر الزامی است" : undefined,
    specialty: !draft.specialty ? "زمینه تخصصی را انتخاب کنید" : undefined,
    monthlyCapacity:
      !draft.monthlyCapacity || Number.isNaN(capacity) || capacity <= 0 ? "ظرفیت ماهانه باید عددی مثبت باشد" : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    const dataset = loadDataset() ?? generateDataset(Date.now());
    const result = applyAction(dataset, {
      type: "application/submit",
      application: {
        companyName: draft.companyName.trim(),
        contactName: draft.contactName.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        city: draft.city.trim(),
        specialty: draft.specialty,
        monthlyCapacity: capacity,
        yearsActive: Number(draft.yearsActive) || 0,
        website: draft.website.trim() || undefined,
        note: draft.note.trim() || undefined,
      },
    });
    saveDataset(result.dataset);
    const created = result.dataset.applications[result.dataset.applications.length - 1];
    setSubmittedCode(created.code);
  };

  if (submittedCode) {
    return (
      <main dir="rtl" className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid="apply-success">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600" aria-hidden="true">
            ✓
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">درخواست شما ثبت شد</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            کد پیگیری شما <span className="font-mono font-medium text-navy">{submittedCode}</span> است.
            تیم کلبه وینتیج درخواست را بررسی می‌کند و نتیجه از طریق ایمیل اعلام می‌شود.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <a
              href="#/"
              className="rounded-xl bg-navy px-4 py-2 text-xs font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              بازگشت به فروشگاه
            </a>
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY);
                setTouched(false);
                setSubmittedCode(null);
              }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              ثبت درخواست دیگر
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 text-center">
          <p className="text-sm font-semibold tracking-tight text-navy">Kolbe Vintage</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">درخواست همکاری تأمین‌کنندگان</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            اگر تولیدکننده یا تأمین‌کننده پوشاک هستید، فرم زیر را تکمیل کنید. پس از بررسی و تأیید،
            حساب تأمین‌کننده برای شما ایجاد می‌شود و درخواست‌های تأمین را دریافت می‌کنید.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          data-testid="apply-form"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="نام شرکت" required error={touched ? errors.companyName : undefined}>
              <TextInput value={draft.companyName} onChange={(v) => setDraft({ ...draft, companyName: v })} invalid={touched && !!errors.companyName} testId="apply-company" />
            </Field>
            <Field label="نام مسئول" required error={touched ? errors.contactName : undefined}>
              <TextInput value={draft.contactName} onChange={(v) => setDraft({ ...draft, contactName: v })} invalid={touched && !!errors.contactName} testId="apply-contact" />
            </Field>
            <Field label="ایمیل" required error={touched ? errors.email : undefined}>
              <TextInput type="email" inputMode="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} invalid={touched && !!errors.email} testId="apply-email" />
            </Field>
            <Field label="شماره تماس" required error={touched ? errors.phone : undefined}>
              <TextInput inputMode="tel" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} invalid={touched && !!errors.phone} testId="apply-phone" />
            </Field>
            <Field label="شهر" required error={touched ? errors.city : undefined}>
              <TextInput value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} invalid={touched && !!errors.city} testId="apply-city" />
            </Field>
            <Field label="زمینه تخصصی" required error={touched ? errors.specialty : undefined}>
              <Select
                value={draft.specialty}
                onChange={(v) => setDraft({ ...draft, specialty: v })}
                placeholder="انتخاب کنید…"
                options={SPECIALTIES.map((s) => ({ value: s, label: s }))}
                invalid={touched && !!errors.specialty}
                testId="apply-specialty"
              />
            </Field>
            <Field label="ظرفیت تولید ماهانه (عدد)" required error={touched ? errors.monthlyCapacity : undefined}>
              <TextInput
                inputMode="numeric"
                value={draft.monthlyCapacity}
                onChange={(v) => setDraft({ ...draft, monthlyCapacity: v.replace(/[^\d]/g, "") })}
                invalid={touched && !!errors.monthlyCapacity}
                testId="apply-capacity"
              />
            </Field>
            <Field label="سابقه فعالیت (سال)">
              <TextInput inputMode="numeric" value={draft.yearsActive} onChange={(v) => setDraft({ ...draft, yearsActive: v.replace(/[^\d]/g, "") })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="وب‌سایت یا اینستاگرام">
                <TextInput inputMode="url" value={draft.website} onChange={(v) => setDraft({ ...draft, website: v })} placeholder="https://" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="توضیحات" hint="محصولات شاخص، برندهایی که با آن‌ها کار کرده‌اید و ظرفیت‌های ویژه">
                <TextArea value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} rows={4} testId="apply-note" />
              </Field>
            </div>
          </div>

          {touched && !valid ? (
            <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              لطفاً خطاهای مشخص‌شده را برطرف کنید.
            </p>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <SubmitButton type="submit" testId="apply-submit">
              ارسال درخواست
            </SubmitButton>
            <a href="#/" className="text-xs text-slate-500 underline-offset-2 hover:underline">
              انصراف و بازگشت به فروشگاه
            </a>
          </div>
        </form>

        <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">
          اطلاعات شما فقط برای بررسی همکاری استفاده می‌شود. تأمین‌کنندگان هرگز به اطلاعات مشتریان
          کلبه وینتیج دسترسی ندارند.
        </p>
      </div>
    </main>
  );
}
