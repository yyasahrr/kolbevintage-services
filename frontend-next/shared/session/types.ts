/**
 * تایپ‌های نشستِ مشترک (فاز ۶.۱).
 *
 * منبعِ حقیقتِ هویت: **کوکیِ HttpOnly و پاسخِ سرور**. این فایل آگاهانه هیچ فیلدی
 * برای «نقشِ ذخیره‌شده در مرورگر» یا «شناسهٔ تأمین‌کننده از localStorage» ندارد،
 * چون فاز ۶.۰ چنین منابعی را صراحتاً غیرِمجاز اعلام کرده است.
 */

import type { CapabilitySet } from "../permissions/capabilities";
import type { ResolvedSessionRole } from "./roles";

export type SessionUser = {
  id: string;
  email: string | null;
  role: ResolvedSessionRole;
  name: string | null;
  phone: string | null;
  totpEnabled: boolean;
};

/** متنِ تأمین‌کننده فقط وقتی پر است که سرور آن را برای این کاربر اعلام کرده باشد. */
export type SupplierSessionContext = {
  supplierId: string;
  displayName: string | null;
  legalName: string | null;
  status: string | null;
};

/**
 * Phase 6.3-B — وضعیتِ عضویتِ VIP/عمده، **فقط از سرور** (`GET /auth/me`).
 * مرورگر هرگز این را از localStorage استنتاج نمی‌کند؛ `kv_wholesale_membership`
 * دیگر مرجعِ عضویت نیست. هیچ مبلغِ تجاری یا فیلدِ ادمین/داخلی حمل نمی‌شود.
 *  - `none`    — بدونِ عضویت/درخواست
 *  - `pending` — درخواست/اشتراک در انتظارِ تأیید
 *  - `active`  — حسابِ تأییدشده + اشتراکِ فعال
 */
export type VipSessionStatus = "none" | "pending" | "active";

export type VipSessionContext = {
  status: VipSessionStatus;
  accountId: string | null;
  memberName: string | null;
  storeName: string | null;
  planName: string | null;
  expiresAt: string | null;
};

export type AuthenticatedSession = {
  status: "authenticated";
  user: SessionUser;
  supplier: SupplierSessionContext | null;
  vip: VipSessionContext | null;
  capabilities: CapabilitySet;
  fetchedAt: string;
  source: "server";
};

export type AnonymousSession = {
  status: "anonymous";
  user: null;
  supplier: null;
  vip: null;
  capabilities: CapabilitySet;
  fetchedAt: string | null;
  source: "server";
};

export type Session = AuthenticatedSession | AnonymousSession;

export type SessionStatus = Session["status"];

/** بدنهٔ پاسخِ `GET /auth/me` روی API canonical. */
export type AuthMeResponse = {
  id: string;
  email: string | null;
  role: string;
  name: string | null;
  phone: string | null;
  totpEnabled: boolean;
  supplier: { supplierId: string; displayName: string | null; legalName: string | null; status?: string | null } | null;
  vip: VipSessionContext | null;
};

/** بدنهٔ پاسخِ `POST /auth/login` روی API canonical. */
export type AuthLoginResponse = {
  user: { id: string; email: string | null; role: string; name: string | null; phone: string | null };
  supplier?: { supplierId: string; displayName: string | null; legalName: string | null; status?: string | null } | null;
  vip?: VipSessionContext | null;
};

export type LoginInput = {
  email: string;
  password: string;
  /** فقط برای مسیرهایی که سرور نقش را در ورود می‌پذیرد (مثلاً ورودِ ادمینِ سازگار). */
  role?: string;
  totpCode?: string;
};

export type AuthPaths = {
  login: string;
  logout: string;
  me: string;
};

/**
 * مسیرهای canonical طبق `truth-registry.ts` (مدخلِ `shared-auth-session`):
 * مالکیتِ «ورود/خروج/بازیابی نشست» با ماژول `auth` است.
 */
export const CANONICAL_AUTH_PATHS: AuthPaths = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
};

/**
 * مسیرهای گذار (`/store/kolbe`) که امروز توسط کلاینت‌های قدیمی استفاده می‌شوند.
 * این‌ها مقصدِ نهایی نیستند و در فازهای ۶.۲–۶.۷ با canonical جایگزین می‌شوند؛
 * فعلاً فقط در همین فایل ثبت شده‌اند تا پراکندگیِ رشته‌ای تکرار نشود.
 */
export const COMPAT_STORE_AUTH_PATHS: AuthPaths = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/me",
};

export const COMPAT_SUPPLIER_AUTH_PATHS: AuthPaths = {
  login: "/supplier/auth/login",
  logout: "/auth/logout",
  me: "/supplier/session",
};
