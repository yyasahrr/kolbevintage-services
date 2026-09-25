/**
 * کلاینتِ نشست/احراز هویتِ مشترک (فاز ۶.۱).
 *
 * جایگزینِ چهار پیاده‌سازیِ موازی است:
 *  - `storefront/lib/siteAuthApi.ts`   (مشتری خرده)
 *  - `storefront/lib/wholesaleVipApi.ts` (VIP/عمده — با خروجِ خودکار هنگام عضویتِ غیرفعال)
 *  - `storefront/lib/wholesaleApi.ts`  (ادمین — «نقش از پاسخِ لاگین»)
 *  - `supplier-src/api.ts`             (تأمین‌کننده — کلاس ApiError جداگانه)
 *
 * قواعدِ تغییرناپذیر:
 *  1. کوکیِ HttpOnly تنها مرجعِ نشست است؛ این کلاینت هیچ توکنی ذخیره نمی‌کند.
 *  2. نقش، شناسهٔ تأمین‌کننده، وضعیتِ VIP و مجوزهای ادمین **فقط** از سرور می‌آیند.
 *  3. «پاسخِ لاگین» مرجعِ هویت نیست: پس از لاگین، هویت با `GET .../me` بازخوانی
 *     می‌شود؛ اگر این بازخوانی شکست بخورد، شکست اعلام می‌شود (هویتِ تقلبی ساخته نمی‌شود).
 *  4. ۴۰۱ یک «پاسخِ معتبر» است (یعنی کاربر وارد نیست) و به نشستِ anonymous
 *     تبدیل می‌شود — در حالی که ۵۰۰/شبکه خطای واقعی است و پنهان نمی‌شود.
 *
 * این ماژول به مرورگر وابسته نیست و با `fetch` تزریق‌شده تست می‌شود.
 */

import { ApiError } from "../http/errors";
import type { ApiClient, ApiResponseMeta, ApiResult } from "../http/types";
import { createCapabilitySet } from "../permissions/capabilities";
import type { CapabilitySet } from "../permissions/capabilities";
import { normalizeServerRole } from "./roles";
import {
  CANONICAL_AUTH_PATHS,
  type AuthLoginResponse,
  type AuthMeResponse,
  type AuthPaths,
  type LoginInput,
  type Session,
  type SessionUser,
  type SupplierSessionContext,
  type VipSessionContext,
} from "./types";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseSupplier(raw: unknown): SupplierSessionContext | null {
  if (!isRecord(raw)) return null;
  const supplierId = readString(raw, "supplierId") ?? readString(raw, "supplier_id") ?? readString(raw, "id");
  if (!supplierId) return null;
  return {
    supplierId,
    displayName: readString(raw, "displayName") ?? readString(raw, "display_name"),
    legalName: readString(raw, "legalName") ?? readString(raw, "legal_name"),
    status: readString(raw, "status"),
  };
}

/**
 * Phase 6.3-B — تفسیرِ `vip` از پاسخِ سرور. اگر سرور وضعیتِ معتبری ندهد، `null`
 * (یعنی «عضویتِ اثبات‌نشده») — هرگز از کشِ مرورگر ساخته نمی‌شود.
 */
function parseVip(raw: unknown): VipSessionContext | null {
  if (!isRecord(raw)) return null;
  const status = readString(raw, "status");
  if (status !== "none" && status !== "pending" && status !== "active") return null;
  // Entitlements default to false unless the server explicitly grants them, so a
  // missing/garbled entitlements block can never widen access.
  const ent = isRecord(raw.entitlements) ? raw.entitlements : {};
  return {
    status,
    accountId: readString(raw, "accountId") ?? readString(raw, "account_id"),
    memberName: readString(raw, "memberName") ?? readString(raw, "member_name"),
    storeName: readString(raw, "storeName") ?? readString(raw, "store_name"),
    planName: readString(raw, "planName") ?? readString(raw, "plan_name"),
    expiresAt: readString(raw, "expiresAt") ?? readString(raw, "expires_at"),
    entitlements: {
      catalog: ent.catalog === true,
      rfq: ent.rfq === true,
      orders: ent.orders === true,
    },
  };
}

function parseSessionUser(raw: unknown, supplier: SupplierSessionContext | null): ParseResult<{ user: SessionUser; supplier: SupplierSessionContext | null }> {
  if (!isRecord(raw)) return { ok: false, reason: "پاسخِ سرور یک شیء معتبر نیست." };
  const id = readString(raw, "id") ?? readString(raw, "sub") ?? readString(raw, "userId") ?? readString(raw, "user_id");
  if (!id) return { ok: false, reason: "پاسخِ سرور شناسهٔ کاربر ندارد." };
  const role = normalizeServerRole(raw.role ?? raw.roleName);
  return {
    ok: true,
    value: {
      supplier,
      user: {
        id,
        email: readString(raw, "email"),
        role,
        name: readString(raw, "name") ?? readString(raw, "displayName") ?? readString(raw, "display_name"),
        phone: readString(raw, "phone"),
        totpEnabled: raw.totpEnabled === true || raw.totp_enabled === true,
      },
    },
  };
}

/** تفسیرِ بدنهٔ `GET /auth/me`. */
export function parseAuthMeResponse(raw: unknown): ParseResult<{ user: SessionUser; supplier: SupplierSessionContext | null; vip: VipSessionContext | null }> {
  if (!isRecord(raw)) return { ok: false, reason: "بدنهٔ /auth/me یک شیء معتبر نیست." };
  const supplier = parseSupplier(raw.supplier ?? raw.supplierContext ?? raw.supplier_context);
  const vip = parseVip(raw.vip ?? raw.vipContext ?? raw.vip_context);
  const parsed = parseSessionUser(raw, supplier);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...parsed.value, vip } };
}

/** تفسیرِ بدنهٔ `POST /auth/login` (فقط برای راستی‌آزمایی؛ مرجعِ هویت نیست). */
export function parseAuthLoginResponse(raw: unknown): ParseResult<AuthLoginResponse> {
  if (!isRecord(raw) || !isRecord(raw.user)) return { ok: false, reason: "بدنهٔ /auth/login شامل user نیست." };
  const user = raw.user;
  const id = readString(user, "id");
  if (!id) return { ok: false, reason: "بدنهٔ /auth/login شناسهٔ کاربر ندارد." };
  return {
    ok: true,
    value: {
      user: {
        id,
        email: readString(user, "email"),
        role: readString(user, "role") ?? "unknown",
        name: readString(user, "name"),
        phone: readString(user, "phone"),
      },
      supplier: parseSupplier(raw.supplier),
    },
  };
}

export type PermissionLoader = (user: SessionUser) => Promise<ApiResult<readonly string[]>>;

export type SessionClientOptions = {
  paths?: AuthPaths;
  /**
   * بارگذارِ اختیاریِ مجوزها برای پورتال‌هایی که قراردادِ capability سروری دارند
   * (مثلاً ادمین در فاز ۶.۴). اگر ست نشود، فهرستِ مجوزها خالی می‌ماند — یعنی
   * «دسترسیِ دانه‌ریز اثبات نشده»، نه «دسترسیِ کامل».
   */
  permissionsLoader?: PermissionLoader;
};

export type SessionClient = {
  readonly paths: AuthPaths;
  login: (input: LoginInput) => Promise<Session>;
  loginResult: (input: LoginInput) => Promise<ApiResult<Session>>;
  logout: () => Promise<void>;
  logoutResult: () => Promise<ApiResult<unknown>>;
  /** بازیابیِ نشست از سرور؛ ۴۰۱ ⇒ anonymousِ معتبر، خطاهای دیگر ⇒ خطا. */
  restore: () => Promise<Session>;
  restoreResult: () => Promise<ApiResult<Session>>;
  /** ادغامِ مجوزهای دریافت‌شده از یک قراردادِ سروری در نشست. */
  withPermissions: (session: Session, permissions: readonly string[]) => Session;
};

export function anonymousSession(fetchedAt: string | null = null): Session {
  return {
    status: "anonymous",
    user: null,
    supplier: null,
    vip: null,
    capabilities: createCapabilitySet(),
    fetchedAt,
    source: "server",
  };
}

export function capabilitiesFor(
  user: SessionUser | null,
  supplier: SupplierSessionContext | null,
  permissions: readonly string[] = [],
  supplierCapabilities: readonly string[] = [],
): CapabilitySet {
  return createCapabilitySet({
    roles: user ? [user.role] : [],
    permissions,
    supplierCapabilities,
    supplierId: supplier?.supplierId ?? null,
  });
}

function authenticated(user: SessionUser, supplier: SupplierSessionContext | null, vip: VipSessionContext | null, capabilities: CapabilitySet): Session {
  return {
    status: "authenticated",
    user,
    supplier,
    vip,
    capabilities,
    fetchedAt: new Date().toISOString(),
    source: "server",
  };
}

export function createSessionClient(client: ApiClient, options: SessionClientOptions = {}): SessionClient {
  const paths = options.paths ?? CANONICAL_AUTH_PATHS;

  /**
   * `stage` مشخص می‌کند شکست در کدام مرحله بوده است. چرا مهم است؟ چون
   * ۴۰۱/۴۰۳ روی خودِ `me` یک پاسخِ معتبر است (نشستی وجود ندارد)، اما همان
   * وضعیت روی قراردادِ capability یعنی «کاربر هست اما دسترسیِ دانه‌ریز نامشخص
   * است» — پنهان کردنش به‌عنوان anonymous دروغ است و باید اعلام شود.
   */
  type SessionRead =
    | { ok: true; data: { user: SessionUser; supplier: SupplierSessionContext | null; vip: VipSessionContext | null; capabilities: CapabilitySet }; meta: ApiResponseMeta }
    | { ok: false; error: ApiError; meta: ApiResponseMeta; stage: "identity" | "permissions" };

  async function readSession(): Promise<SessionRead> {
    const result = await client.requestResult<unknown>(paths.me);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        stage: "identity",
        meta: { status: result.error.status ?? 0, url: paths.me, method: "GET", requestId: result.error.requestId, headers: new Headers() },
      };
    }
    const parsed = parseAuthMeResponse(result.data);
    if (!parsed.ok) {
      const error = new ApiError({
        kind: "MALFORMED_RESPONSE",
        status: result.meta.status,
        code: "SESSION_CONTRACT_VIOLATION",
        message: parsed.reason,
        requestId: result.meta.requestId,
        transport: "protocol",
        body: result.data,
      });
      return { ok: false, error, meta: result.meta, stage: "identity" };
    }
    let permissions: readonly string[] = [];
    if (options.permissionsLoader) {
      const loaded = await options.permissionsLoader(parsed.value.user);
      if (!loaded.ok) {
        return {
          ok: false,
          error: loaded.error,
          stage: "permissions",
          meta: { status: loaded.error.status ?? 0, url: paths.me, method: "GET", requestId: loaded.error.requestId, headers: new Headers() },
        };
      }
      permissions = loaded.data;
    }
    const capabilities = capabilitiesFor(parsed.value.user, parsed.value.supplier, permissions);
    return { ok: true, data: { ...parsed.value, capabilities }, meta: result.meta };
  }

  async function restoreResult(): Promise<ApiResult<Session>> {
    const result = await readSession();
    if (!result.ok) {
      // ۴۰۱/۴۰۳ روی خودِ نشست یعنی «وارد نیستید / اجازه ندارید» — یک پاسخِ معتبر
      // است، نه شکست. اما همان وضعیت از قراردادِ capability باید اعلام شود.
      const notSignedIn = result.error.kind === "UNAUTHORIZED" || result.error.kind === "FORBIDDEN";
      if (result.stage === "identity" && notSignedIn) {
        return { ok: true, data: anonymousSession(), meta: result.meta };
      }
      return { ok: false, error: result.error, meta: result.meta };
    }
    const { user, supplier, vip, capabilities } = result.data;
    return { ok: true, data: authenticated(user, supplier, vip, capabilities), meta: result.meta };
  }

  async function loginResult(input: LoginInput): Promise<ApiResult<Session>> {
    const loginResponse = await client.requestResult<unknown>(paths.login, {
      method: "POST",
      body: { email: input.email, password: input.password, ...(input.role ? { role: input.role } : {}), ...(input.totpCode ? { totpCode: input.totpCode } : {}) },
    });
    if (!loginResponse.ok) return loginResponse;
    if (!isRecord(loginResponse.data)) {
      const error = new ApiError({
        kind: "MALFORMED_RESPONSE",
        status: loginResponse.meta.status,
        code: "SESSION_CONTRACT_VIOLATION",
        message: "بدنهٔ پاسخِ ورود یک شیء معتبر نیست.",
        requestId: loginResponse.meta.requestId,
        transport: "protocol",
        body: loginResponse.data,
      });
      return { ok: false, error, meta: loginResponse.meta };
    }
    // پاسخِ لاگین هرگز مرجعِ هویت نیست (کوکی همین‌جا ست شده است)؛
    // هویت با یک درخواستِ جداگانه از سرور خوانده می‌شود.
    return restoreResult();
  }

  async function logoutResult(): Promise<ApiResult<unknown>> {
    return client.requestResult<unknown>(paths.logout, { method: "POST" });
  }

  function withPermissions(session: Session, permissions: readonly string[]): Session {
    if (session.status !== "authenticated") return session;
    return {
      ...session,
      capabilities: capabilitiesFor(session.user, session.supplier, permissions, session.capabilities.supplierCapabilities),
    };
  }

  return {
    paths,
    loginResult,
    login: async (input: LoginInput) => {
      const result = await loginResult(input);
      if (!result.ok) throw result.error;
      return result.data;
    },
    logoutResult,
    logout: async () => {
      const result = await logoutResult();
      if (!result.ok) throw result.error;
    },
    restoreResult,
    restore: async () => {
      const result = await restoreResult();
      if (!result.ok) throw result.error;
      return result.data;
    },
    withPermissions,
  };
}
