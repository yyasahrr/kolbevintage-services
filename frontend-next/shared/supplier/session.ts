/**
 * نشستِ تأمین‌کننده روی مرز مشترک (فاز ۶.۲).
 *
 * تفاوت با نشستِ عمومی: اینجا «هویتِ تأمین‌کننده» و «قابلیت‌های اعلام‌شده توسط
 * سرور» به نشست اضافه می‌شوند — اما باز هم **همه‌چیز از سرور** می‌آید:
 *
 *   POST /auth/supplier/login  →  فقط ست‌کردن کوکی؛ پاسخ مرجعِ هویت نیست
 *   GET  /auth/me              →  شناسهٔ کاربر، نقش و متنِ تأمین‌کننده
 *   GET  /supplier/production/capabilities → کدهای capability (اگر مجاز باشد)
 *
 * هیچ مقداری از localStorage، نشانی یا بدنهٔ ورود به‌عنوان هویت/نقش/مجوز پذیرفته
 * نمی‌شود. حالتِ نمایشی (demo) فقط با فلگِ صریحِ محیطی و با برچسبِ دائمی در UI
 * فعال است و هرگز در تولید به‌عنوان جایگزینِ خاموش استفاده نمی‌شود.
 */

import { ApiError } from "../http/errors";
import type { ApiClient, ApiResult } from "../http/types";
import { createCapabilitySet, type CapabilitySet } from "../permissions/capabilities";
import { ANONYMOUS_CAPABILITIES, canUseProduction } from "../permissions/capabilities";
import { anonymousSession, capabilitiesFor, type Session, type SessionUser, type SupplierSessionContext } from "../session";
import type { SupplierApi } from "./client";

export const DEMO_FLAG_ENV = "NEXT_PUBLIC_SUPPLIER_DEMO";

/** آیا حالتِ نمایشی اجازهٔ فعال‌شدن دارد؟ در تولید بدون فلگ هرگز. */
export function isDemoModeAllowed(): boolean {
  const raw = readEnv(DEMO_FLAG_ENV);
  return raw === "1" || raw === "true";
}

function readEnv(key: string): string | undefined {
  try {
    const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
    return value && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export type SupplierIdentity = {
  supplierId: string;
  displayName: string | null;
  legalName: string | null;
};

export type SupplierSession = Session & {
  /** capabilityهای تولید اعلام‌شده توسط سرور (ممکن است خالی یا نامشخص باشد). */
  productionCapabilities: readonly string[];
  /** آیا capabilityها با موفقیت از سرور خوانده شده‌اند؟ */
  capabilitiesLoaded: boolean;
  /** اگر خواندنِ قابلیت‌ها با منع/عدم‌دسترسی روبه‌رو شده، دلیلش اینجاست. */
  capabilitiesError: ApiError | null;
};

export function toSupplierSession(session: Session): SupplierSession {
  return { ...session, productionCapabilities: [], capabilitiesLoaded: false, capabilitiesError: null };
}

function supplierContextOf(session: Session): SupplierSessionContext | null {
  return session.status === "authenticated" ? session.supplier : null;
}

/**
 * نشستِ تأمین‌کننده باید نقشِ `supplier` و متنِ تأمین‌کننده را از سرور داشته باشد.
 * اگر نقش چیزِ دیگری بود، این یک نشستِ تأمین‌کننده نیست — خطا برمی‌گردد تا
 * پورتال با وضعیتِ «دسترسی ندارید» رندر شود (نه اینکه وانمود کند وارد شده است).
 */
export class SupplierSessionError extends Error {
  constructor(
    readonly code: "NOT_SUPPLIER" | "NO_SUPPLIER_TENANT",
    message: string,
  ) {
    super(message);
    this.name = "SupplierSessionError";
  }
}

export type SupplierSessionClient = {
  login: (email: string, password: string) => Promise<SupplierSession>;
  loginResult: (email: string, password: string) => Promise<ApiResult<SupplierSession>>;
  restore: () => Promise<SupplierSession>;
  restoreResult: () => Promise<ApiResult<SupplierSession>>;
  logout: () => Promise<void>;
  logoutResult: () => Promise<ApiResult<unknown>>;
  health: () => Promise<boolean>;
};

export function createSupplierSessionClient(client: ApiClient, api: SupplierApi): SupplierSessionClient {
  async function readCapabilities(supplierSession: Session): Promise<{
    capabilities: CapabilitySet;
    productionCapabilities: readonly string[];
    capabilitiesLoaded: boolean;
    capabilitiesError: ApiError | null;
  }> {
    if (supplierSession.status !== "authenticated") {
      return {
        capabilities: ANONYMOUS_CAPABILITIES,
        productionCapabilities: [],
        capabilitiesLoaded: false,
        capabilitiesError: null,
      };
    }
    const result = await api.production.capabilities();
    if (!result.ok) {
      // عدمِ دسترسی به قرارداد capability به‌معنای «بدون capability» است، نه خطای پورتال.
      const denied = result.error.kind === "FORBIDDEN" || result.error.kind === "UNAUTHORIZED" || result.error.kind === "NOT_FOUND";
      return {
        capabilities: capabilitiesFor(supplierSession.user, supplierSession.supplier, []),
        productionCapabilities: [],
        capabilitiesLoaded: denied,
        capabilitiesError: denied ? null : result.error,
      };
    }
    const codes = (result.data.capabilities ?? [])
      .map((capability) => capability.capabilityCode)
      .filter((code): code is string => typeof code === "string" && code.length > 0);
    return {
      capabilities: capabilitiesFor(supplierSession.user, supplierSession.supplier, [], codes),
      productionCapabilities: codes,
      capabilitiesLoaded: true,
      capabilitiesError: null,
    };
  }

  async function decorate(session: Session): Promise<SupplierSession> {
    if (session.status !== "authenticated") return toSupplierSession(session);
    const loaded = await readCapabilities(session);
    return {
      ...session,
      capabilities: loaded.capabilities,
      productionCapabilities: loaded.productionCapabilities,
      capabilitiesLoaded: loaded.capabilitiesLoaded,
      capabilitiesError: loaded.capabilitiesError,
    };
  }

  function assertSupplier(session: Session): void {
    if (session.status !== "authenticated") return;
    if (session.user.role !== "supplier") {
      throw new SupplierSessionError("NOT_SUPPLIER", "این حساب دسترسی پنل تأمین‌کننده ندارد.");
    }
    if (!supplierContextOf(session)?.supplierId) {
      throw new SupplierSessionError("NO_SUPPLIER_TENANT", "برای این حساب هیچ تأمین‌کننده‌ای ثبت نشده است.");
    }
  }

  async function restoreResult(): Promise<ApiResult<SupplierSession>> {
    const me = await client.requestResult<Record<string, unknown>>("/auth/me");
    if (!me.ok) {
      if (me.error.kind === "UNAUTHORIZED" || me.error.kind === "FORBIDDEN") {
        return { ok: true, data: toSupplierSession(anonymousSession()), meta: me.meta };
      }
      return me;
    }
    const session = parseSupplierMe(me.data);
    if (session.status === "anonymous") {
      return { ok: true, data: toSupplierSession(session), meta: me.meta };
    }
    try {
      assertSupplier(session);
    } catch (error) {
      const apiError =
        error instanceof SupplierSessionError
          ? new ApiError({ kind: "FORBIDDEN", status: 403, code: error.code, message: error.message })
          : new ApiError({ kind: "UNKNOWN", message: "نشست تأمین‌کننده قابل تأیید نیست." });
      return { ok: false, error: apiError, meta: me.meta };
    }
    return { ok: true, data: await decorate(session), meta: me.meta };
  }

  async function loginResult(email: string, password: string): Promise<ApiResult<SupplierSession>> {
    const login = await api.auth.login({ email, password });
    if (!login.ok) return login;
    return restoreResult();
  }

  return {
    loginResult,
    login: async (email: string, password: string) => {
      const result = await loginResult(email, password);
      if (!result.ok) throw result.error;
      return result.data;
    },
    restoreResult,
    restore: async () => {
      const result = await restoreResult();
      if (!result.ok) throw result.error;
      return result.data;
    },
    logoutResult: () => api.auth.logout(),
    logout: async () => {
      const result = await api.auth.logout();
      if (!result.ok) throw result.error;
    },
    health: async () => {
      const result = await api.auth.health();
      return result.ok;
    },
  };
}

/** تفسیرِ پاسخِ `/auth/me` با همان قراردادِ سرور (`supplier: { supplierId, displayName, legalName }`). */
export function parseSupplierMe(raw: unknown): Session {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return anonymousSession();
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return anonymousSession();

  const rawSupplier = record.supplier;
  const supplier: SupplierSessionContext | null =
    typeof rawSupplier === "object" && rawSupplier !== null && !Array.isArray(rawSupplier)
      ? (() => {
          const supplierRecord = rawSupplier as Record<string, unknown>;
          const supplierId = supplierRecord.supplierId ?? supplierRecord.id;
          if (typeof supplierId !== "string" || supplierId.length === 0) return null;
          return {
            supplierId,
            displayName: typeof supplierRecord.displayName === "string" ? supplierRecord.displayName : null,
            legalName: typeof supplierRecord.legalName === "string" ? supplierRecord.legalName : null,
            status: typeof supplierRecord.status === "string" ? supplierRecord.status : null,
          };
        })()
      : null;

  const user: SessionUser = {
    id,
    email: typeof record.email === "string" ? record.email : null,
    role: typeof record.role === "string" ? (record.role as SessionUser["role"]) : "unknown",
    name: typeof record.name === "string" ? record.name : null,
    phone: typeof record.phone === "string" ? record.phone : null,
    totpEnabled: record.totpEnabled === true,
  };

  return {
    status: "authenticated",
    user,
    supplier,
    capabilities: capabilitiesFor(user, supplier),
    fetchedAt: new Date().toISOString(),
    source: "server",
  };
}

/* ── دروازهٔ capability ─────────────────────────────────────────────────────
 * «تأمین‌کننده» مترادفِ «تولیدکننده» نیست. دیدنِ بخشِ تولید نیازمند capability
 * صریحِ اعلام‌شده از سوی سرور است.
 */
export function canUseProductionPortal(session: SupplierSession): boolean {
  if (session.status !== "authenticated") return false;
  return canUseProduction(
    createCapabilitySet({
      roles: [session.user.role],
      permissions: [],
      supplierCapabilities: session.productionCapabilities,
      supplierId: session.supplier?.supplierId ?? null,
    }),
  );
}

export function supplierIdOf(session: SupplierSession): string | null {
  return session.status === "authenticated" ? (session.supplier?.supplierId ?? null) : null;
}
