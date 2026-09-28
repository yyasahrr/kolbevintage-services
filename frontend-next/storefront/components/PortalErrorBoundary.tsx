/**
 * محافظ خطای پنل‌ها — الزام پاسخ ۷۹ کاربر: «هیچ صفحهٔ سفید/کرشی نداشته باشیم».
 *
 * هر پنل (ادمین، VIP، عمده، تأمین‌کننده) داخل این محافظ اجرا می‌شود. اگر رندر
 * به هر دلیلی استثنا بدهد، کاربر یک صفحهٔ فارسی با دکمهٔ بازیابی می‌بیند و خطا
 * در لاگ کلاینت ثبت می‌شود — بدون لو دادن هیچ جزئیات داخلی در UI.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportApiIssue } from "../lib/clientLogger";

type Props = { children: ReactNode; title?: string };
type State = { error: Error | null };

export default class PortalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // ثبت در همان مسیر لاگ کلاینت؛ متن خطا در UI نمایش داده نمی‌شود.
    reportApiIssue("portal/render", "RENDER", undefined, error.message.slice(0, 120));
    if (process.env.NODE_ENV !== "production") console.error("[kolbe] portal render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      // نشانگر ساختاری: تست‌ها و ابزارها می‌توانند ببینند این بخش محافظ دارد.
      return <div data-portal-boundary="true">{this.props.children}</div>;
    }

    return (
      <div className="admin-system grid min-h-screen place-items-center bg-[var(--kv-canvas)] px-4" data-portal-error="true">
        <div className="w-full max-w-[420px] rounded-[var(--kv-radius-surface)] border border-[var(--kv-border)] bg-[var(--kv-surface)] p-6 text-center">
          <p className="kv-label text-[var(--kv-text-muted)]">{this.props.title ?? "پنل مدیریت"}</p>
          <h1 className="kv-title mt-2">نمایش این بخش ممکن نشد</h1>
          <p className="kv-body-sm mt-3 text-[var(--kv-text-muted)]">
            خطایی در بارگذاری رخ داد. داده‌ها ذخیره شده‌اند؛ فقط نمایش این صفحه بازیابی می‌شود.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-[var(--kv-radius-control)] border border-[var(--kv-border-strong)] px-4 py-2 text-[12px]"
            >
              تلاش دوباره
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-[var(--kv-radius-control)] bg-[var(--kv-primary)] px-4 py-2 text-[12px] text-[var(--kv-on-primary)]"
            >
              بارگذاری مجدد صفحه
            </button>
          </div>
        </div>
      </div>
    );
  }
}
