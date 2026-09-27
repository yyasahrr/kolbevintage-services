import { ApiError, type ApiErrorKind } from "../http/errors";

export type AuthErrorPresentation = {
  kind: ApiErrorKind | "ACCESS_DENIED" | "TOTP_REQUIRED";
  title: string;
  message: string;
  retryAfterSeconds: number | null;
};

export function presentAuthError(error: unknown): AuthErrorPresentation {
  if (!(error instanceof ApiError)) {
    return { kind: "UNKNOWN", title: "ورود انجام نشد", message: "خطای پیش‌بینی‌نشده‌ای رخ داد. دوباره تلاش کنید.", retryAfterSeconds: null };
  }
  if (error.code === "TOTP_REQUIRED") {
    return { kind: "TOTP_REQUIRED", title: "تأیید دومرحله‌ای لازم است", message: "کد یک‌بارمصرف برنامهٔ احراز هویت را وارد کنید.", retryAfterSeconds: null };
  }
  switch (error.kind) {
    case "UNAUTHORIZED": return { kind: error.kind, title: "اطلاعات ورود پذیرفته نشد", message: "ایمیل یا رمز عبور درست نیست.", retryAfterSeconds: null };
    case "FORBIDDEN": return { kind: error.kind, title: "دسترسی مجاز نیست", message: "این حساب به این فضای کاری دسترسی ندارد.", retryAfterSeconds: null };
    case "RATE_LIMITED": {
      const wait = error.retryAfterSeconds;
      return { kind: error.kind, title: "تلاش‌های ورود بیش از حد است", message: wait === null ? "کمی صبر کنید و سپس دوباره تلاش کنید." : `لطفاً ${new Intl.NumberFormat("fa-IR").format(wait)} ثانیه صبر کنید و دوباره تلاش کنید.`, retryAfterSeconds: wait };
    }
    case "NETWORK_ERROR": return { kind: error.kind, title: "ارتباط برقرار نشد", message: "اتصال به سرور برقرار نیست. وضعیت شبکه را بررسی کنید.", retryAfterSeconds: null };
    case "SERVER_ERROR":
    case "PROVIDER_UNAVAILABLE": return { kind: error.kind, title: "سرویس موقتاً در دسترس نیست", message: "سرور نتوانست ورود را کامل کند. کمی بعد دوباره تلاش کنید.", retryAfterSeconds: null };
    case "MALFORMED_RESPONSE": return { kind: error.kind, title: "هویت قابل تأیید نیست", message: "پاسخ نشست با قرارداد امن ورود هم‌خوان نبود.", retryAfterSeconds: null };
    case "VALIDATION_ERROR": return { kind: error.kind, title: "اطلاعات را بررسی کنید", message: "ایمیل و رمز عبور را با قالب درست وارد کنید.", retryAfterSeconds: null };
    default: return { kind: error.kind, title: "ورود کامل نشد", message: "درخواست ورود کامل نشد. دوباره تلاش کنید.", retryAfterSeconds: null };
  }
}

export function requiresTotp(error: unknown): boolean {
  return error instanceof ApiError && error.code === "TOTP_REQUIRED";
}

export function accessDenied(message: string): AuthErrorPresentation {
  return { kind: "ACCESS_DENIED", title: "دسترسی مجاز نیست", message, retryAfterSeconds: null };
}
