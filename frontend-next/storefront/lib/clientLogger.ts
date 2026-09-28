import { KOLBE_API_BASE } from "../nextEnv";

type ClientIssue = {
  type: "window.error" | "unhandledrejection" | "api.error";
  message: string;
  name?: string;
  stack?: string;
  url?: string;
  method?: string;
  status?: number;
  line?: number;
  column?: number;
  componentStack?: string;
};

const ENDPOINT = `${KOLBE_API_BASE}/store/kolbe/logs/client`;
const RELEASE = process.env.NEXT_PUBLIC_RELEASE ?? "kolbe-web-2026.09.02";
const recent = new Map<string, number>();
let initialized = false;

function trim(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function shouldSend(issue: ClientIssue) {
  const key = `${issue.type}|${trim(issue.message, 300)}|${trim(issue.stack?.split("\n")[0], 180)}|${issue.status ?? ""}`;
  const now = Date.now();
  const previous = recent.get(key) ?? 0;
  recent.set(key, now);
  if (recent.size > 100) {
    for (const [fingerprint, time] of recent) if (now - time > 60_000) recent.delete(fingerprint);
  }
  return now - previous > 10_000;
}

export function reportClientIssue(issue: ClientIssue) {
  if (typeof window === "undefined" || !shouldSend(issue)) return;
  const payload = {
    ...issue,
    message: trim(issue.message, 2_000) || "خطای بدون پیام",
    name: issue.name ? trim(issue.name, 160) : undefined,
    stack: issue.stack ? trim(issue.stack, 12_000) : undefined,
    url: issue.url ?? window.location.href,
    release: RELEASE,
  };
  /**
   * ⚠️ پس از اصلاح D21، این endpoint نشست می‌خواهد.
   *
   * نخستین خط دفاع علیه «نوشتنِ آزاد در لاگ» همان احراز هویت است، پس تلمتری خطای
   * سمت مرورگر فقط برای کاربرِ وارد‌شده ثبت می‌شود. چون API روی همان مبدأ سرو
   * می‌شود (`/store/kolbe/...`)، کوکی HttpOnly نشست با `credentials: "same-origin"`
   * همراه درخواست می‌رود؛ برای کاربر ناشناس درخواست ۴۰۱ می‌گیرد و بی‌صدا رد
   * می‌شود (هیچ نویزی در کنسول ایجاد نمی‌کنیم).
   *
   * بازگرداندن تلمتری خطای کاربران ناشناس کار فاز ۶ است: با یک endpoint عمومیِ
   * سهمیه‌دار و امضاشده (نه یک درج بی‌قید در دیتابیس).
   */
  void fetch(ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

export function reportApiIssue(path: string, method: string, status: number | undefined, message: string) {
  if (path.includes("/logs/client")) return;
  reportClientIssue({ type: "api.error", message, url: path, method, status });
}

export function initializeClientLogging() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (event) => {
    reportClientIssue({
      type: "window.error",
      message: event.message || "خطای اجرای مرورگر",
      name: event.error instanceof Error ? event.error.name : "WindowError",
      stack: event.error instanceof Error ? event.error.stack : undefined,
      url: event.filename || window.location.href,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason instanceof Error ? event.reason : null;
    reportClientIssue({
      type: "unhandledrejection",
      message: error?.message ?? trim(event.reason, 2_000) ?? "Promise rejection",
      name: error?.name ?? "UnhandledRejection",
      stack: error?.stack,
      url: window.location.href,
    });
  });
}
