import { Card, CardHeader, SectionTitle } from "../components/primitives";
import { ActionButton } from "../components/ActionButton";
import { savedAt } from "../lib/persistence";
import { SLA } from "../domain/generate";
import { formatDateTimeDual } from "../lib/format";
import { useDashboard } from "../state";
import type { ThemeMode } from "../lib/useTheme";
import { cn } from "@/utils/cn";

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: "light", label: "روشن" },
  { value: "dark", label: "تیره" },
  { value: "system", label: "سیستم" },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-sm last:border-0 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

export function SettingsPage({
  themeMode,
  onThemeChange,
}: {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}) {
  const { data, resetData, persisted } = useDashboard();
  const lastSaved = savedAt();

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="قواعد جاری موتور عملیات">تنظیمات کسب‌وکار</SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="قواعد SLA تأمین" subtitle="مبنای محاسبه تأخیرها و هشدارها" />
            <Row label="پذیرش درخواست" value={`حداکثر ${SLA.acceptHours} ساعت`} />
            <Row label="آماده‌سازی" value={`حداکثر ${SLA.prepareHours} ساعت`} />
            <Row label="ارسال" value={`حداکثر ${SLA.shipHours} ساعت`} />
            <Row label="بازه بازرسی مشتری" value={`${SLA.inspectionHours} ساعت (۳ روز)`} />
          </Card>

          <Card>
            <CardHeader title="مدل کمیسیون" subtitle="پلکانی بر اساس حجم و تأمین‌کننده" />
            <Row label="حداقل نرخ" value="۸٪" />
            <Row label="حداکثر نرخ" value="۱۲٪" />
            <Row label="مبنای محاسبه" value="ارزش سفارش تأمین‌شده (سمت مشتری)" />
            <Row label="ترتیب کسورات" value="کمیسیون ← بازپرداخت ← تعدیل‌ها" />
          </Card>

          <Card>
            <CardHeader title="ظاهر داشبورد" subtitle="پوسته و زبان" />
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <span className="text-sm text-slate-500 dark:text-slate-400">حالت نمایش</span>
              <div className="flex items-center gap-1" role="group" aria-label="انتخاب پوسته">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => onThemeChange(m.value)}
                    aria-pressed={themeMode === m.value}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
                      themeMode === m.value
                        ? "border-navy bg-navy text-white dark:border-sky-500 dark:bg-sky-500/20 dark:text-sky-200"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <Row label="زبان رابط" value="فارسی (RTL) با ارقام لاتین" />
            <Row label="واحد پول" value="تومان" />
            <Row label="تقویم" value="میلادی + شمسی (دوگانه)" />
          </Card>

          <Card>
            <CardHeader title="جداسازی دامنه" subtitle="قواعد غیرقابل نقض معماری" />
            <Row label="ارتباط مشتری" value="فقط با کلبه وینتیج" />
            <Row label="ارتباط تأمین‌کننده" value="فقط با کلبه وینتیج" />
            <Row label="سفارش مشتری" value="≠ درخواست تأمین" />
            <Row label="پرداخت مشتری" value="≠ تسویه تأمین‌کننده" />
            <Row label="مبلغ سفارش" value="≠ مبلغ قابل پرداخت تأمین‌کننده" />
          </Card>

          <Card>
            <CardHeader title="کاربر جاری" subtitle="نقش ثابت این نسخه" />
            <Row label="نام" value="نازنین رحیمی" />
            <Row label="نقش" value="Kolbe Vintage Operations Admin" />
            <Row label="دسترسی" value="عملیات، مالی، گزارش" />
          </Card>

          <Card>
            <CardHeader
              title="داده‌ها"
              subtitle="ذخیره‌شده در localStorage — تغییرات شما بین بارگذاری‌ها حفظ می‌شود"
              action={
                <ActionButton variant="danger" onClick={resetData} testId="reset-data">
                  بازنشانی داده نمونه
                </ActionButton>
              }
            />
            <Row label="وضعیت ذخیره‌سازی" value={persisted ? "ذخیره‌شده در مرورگر" : "داده تازه تولیدشده"} />
            <Row label="آخرین ذخیره" value={lastSaved ? formatDateTimeDual(lastSaved) : "—"} />
            <Row label="زمان تولید" value={formatDateTimeDual(data.generatedAt)} />
            <Row label="سفارش‌ها" value={String(data.orders.length)} />
            <Row label="درخواست‌های تأمین" value={String(data.fulfillments.length)} />
            <Row label="تأمین‌کنندگان" value={String(data.suppliers.length)} />
            <Row label="مشتریان VIP" value={String(data.customers.length)} />
            <Row label="محصولات" value={String(data.products.length)} />
          </Card>
        </div>
      </section>
    </div>
  );
}
