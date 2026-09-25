/**
 * سرویس احراز هویت — فاز ۲.
 *
 * مالک جدول‌های `account_user`, `login_attempt`, `user_session`.
 * مسئولیت‌ها:
 *  - ثبت‌نام (فقط customer از مسیر عمومی؛ admin/supplier فقط با نقش admin)
 *  - ورود با ردیابی تلاش و قفل موقت
 *  - خروج با افزایش token_version و ابطال نشست‌ها
 *  - صدور توکن HMAC با نسخه (tv) برای ابطال
 *  - بازیابی اطلاعات کاربر (me) و supplier context
 *
 * قاعده‌ها:
 *  - A9: کوکی HttpOnly تنها اعتبار کلاینت است؛ هیچ توکنی در localStorage نمی‌رود
 *  - D35: Origin check در guard انجام می‌شود، اینجا فقط لاگ
 *  - token_version: هر logout یا تغییر رمز، نسخه را افزایش می‌دهد و همهٔ توکن‌های قبلی باطل می‌شوند
 */

import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, and, gte, desc, isNull } from "drizzle-orm";
import { accountUser, loginAttempt, supplierMember, supplier, userSession, vipSubscription, wholesaleAccount } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { SessionVerifier, type Role } from "../../common/session";
import { TotpService } from "./totp.service";
import { ConflictError, UnauthorizedError, ForbiddenError, ValidationError, DomainError } from "@kolbe/shared";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  phone: string | null;
  status: string;
  tokenVersion: number;
  totpEnabled?: boolean;
};

/**
 * Phase 6.3-B — normalized VIP/wholesale membership context derived from the
 * canonical tables (`wholesale_account` + `vip_subscription`). This is the
 * server-authoritative membership state exposed on the session; it carries no
 * commercial totals and no admin/internal fields. The browser must treat this
 * (via `/auth/me`), not localStorage, as the membership authority.
 *  - `none`    — no membership / application
 *  - `pending` — application or subscription awaiting approval
 *  - `active`  — approved account AND an active (unexpired) subscription
 */
export type VipEntitlements = {
  /** Approved, unexpired wholesale account → wholesale catalog eligibility. */
  catalog: boolean;
  /** Catalog eligibility PLUS an active VIP subscription → RFQ/request creation. */
  rfq: boolean;
  /** Approved account → wholesale ordering (orders derive from accepted requests). */
  orders: boolean;
};

export type VipContext = {
  status: "none" | "pending" | "active";
  accountId: string | null;
  memberName: string | null;
  storeName: string | null;
  planName: string | null;
  expiresAt: string | null;
  /**
   * Phase 6.3-B — capability entitlements derived from canonical backend state.
   * Membership (`status==="active"`) is NOT the same as every capability: RFQ
   * additionally requires an active subscription. The frontend must gate each
   * operation on the matching entitlement, never on `status` alone.
   */
  entitlements: VipEntitlements;
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ATTEMPT_WINDOW_MINUTES = 15;

function passwordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
}

function passwordMatches(password: string, salt: string, stored: string): boolean {
  try {
    const candidate = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
    const expected = Buffer.from(stored, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

@Injectable()
export class AuthService {
  private readonly verifier: SessionVerifier;
  private readonly totp = new TotpService();

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {
    this.verifier = new SessionVerifier(config.sessionSecret);
  }

  async register(input: {
    email: string;
    password: string;
    name?: string;
    phone?: string;
    role?: string;
    requesterRole?: Role | null;
    ip?: string | null;
  }): Promise<{ user: AuthUser; token: string }> {
    const email = input.email.trim().toLowerCase();
    if (input.password.length < 8 || input.password.length > 128) {
      throw new ValidationError([{ field: "password", code: "PASSWORD_LENGTH_INVALID" }], "رمز عبور باید بین ۸ تا ۱۲۸ نویسه باشد");
    }
    const role = (input.role ?? "customer") as Role;

    // فقط customer از مسیر عمومی؛ نقش‌های خاص فقط با ادمین
    if (role !== "customer") {
      if (input.requesterRole !== "admin") {
        throw new ForbiddenError("FORBIDDEN", "ایجاد نقش ادمین/تأمین‌کننده فقط با حساب مدیر ممکن است");
      }
    }

    const existing = await this.db
      .select({ id: accountUser.id })
      .from(accountUser)
      .where(eq(accountUser.email, email))
      .limit(1);
    if (existing.length) throw new ConflictError("EMAIL_EXISTS", "این ایمیل قبلاً ثبت شده است");

    const { salt, passwordHash } = passwordRecord(input.password);
    const id = makeId("usr");

    const [created] = await this.db
      .insert(accountUser)
      .values({
        id,
        email,
        passwordHash,
        salt,
        role,
        displayName: input.name?.trim() || null,
        phone: input.phone?.trim() || null,
        status: "active",
        tokenVersion: 0,
        failedLoginAttempts: 0,
      })
      .returning({
        id: accountUser.id,
        email: accountUser.email,
        role: accountUser.role,
        displayName: accountUser.displayName,
        phone: accountUser.phone,
        status: accountUser.status,
        tokenVersion: accountUser.tokenVersion,
      });

    const token = this.verifier.issue(created.id, created.role as Role, created.tokenVersion);
    await this.createSession(created.id, token, input.ip ?? null, null);

    return { user: created as AuthUser, token };
  }

  async login(input: {
    email: string;
    password: string;
    role?: string;
    totpCode?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ user: AuthUser; token: string; supplierContext?: { supplierId: string; displayName: string; legalName: string } | null; vipContext?: VipContext }> {
    const email = input.email.trim().toLowerCase();

    const [user] = await this.db
      .select()
      .from(accountUser)
      .where(eq(accountUser.email, email))
      .limit(1);

    // ثبت تلاش ناموفق حتی اگر کاربر وجود ندارد (جلوگیری از user enumeration via timing)
    if (!user) {
      await this.recordAttempt(null, email, input.ip ?? null, false);
      throw new UnauthorizedError("ایمیل یا رمز عبور درست نیست");
    }

    // بررسی قفل موقت — ۴۲۳ قفل‌شده، نه ۴۰۳ ممنوع
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      throw new DomainError(423, "ACCOUNT_LOCKED", "حساب به‌صورت موقت قفل شده است؛ بعداً تلاش کنید");
    }
    if (user.status !== "active") {
      throw new ForbiddenError("ACCOUNT_SUSPENDED", "حساب کاربری فعال نیست");
    }

    // بررسی نقش درخواستی (مثلاً ورود ادمین فقط با نقش admin)
    if (input.role && user.role !== input.role) {
      await this.recordAttempt(user.id, email, input.ip ?? null, false);
      throw new UnauthorizedError("این حساب دسترسی مورد نظر را ندارد");
    }

    const ok = passwordMatches(input.password, user.salt, user.passwordHash);
    if (!ok) {
      await this.handleFailedAttempt(user);
      await this.recordAttempt(user.id, email, input.ip ?? null, false);
      throw new UnauthorizedError("ایمیل یا رمز عبور درست نیست");
    }

    // اگر TOTP فعال است، کد دومرحله‌ای الزامی است
    if ((user as any).totpEnabled) {
      if (!input.totpCode) {
        throw new DomainError(401, "TOTP_REQUIRED", "کد دومرحله‌ای لازم است");
      }
      const secret = (user as any).totpSecret as string | null;
      if (!secret || !this.totp.verify(secret, input.totpCode)) {
        await this.recordAttempt(user.id, email, input.ip ?? null, false);
        throw new DomainError(401, "INVALID_TOTP", "کد دومرحله‌ای نامعتبر است");
      }
    }

    // موفق — بازنشانی شمارش خطا و ثبت ورود
    await this.db
      .update(accountUser)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accountUser.id, user.id));

    await this.recordAttempt(user.id, email, input.ip ?? null, true);

    const token = this.verifier.issue(user.id, user.role as Role, user.tokenVersion);
    await this.createSession(user.id, token, input.ip ?? null, input.userAgent ?? null);

    let supplierContext: { supplierId: string; displayName: string; legalName: string } | null = null;
    if (user.role === "supplier") {
      supplierContext = await this.supplierContext(user.id);
    }
    // Phase 6.3-B — membership travels with the session from login onward.
    const vipContext = await this.vipContext(user.id);

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      displayName: user.displayName,
      phone: user.phone,
      status: user.status,
      tokenVersion: user.tokenVersion,
    };

    return { user: authUser, token, supplierContext, vipContext };
  }

  async logout(userId: string): Promise<void> {
    // افزایش نسخهٔ توکن — همهٔ توکن‌های قبلی باطل می‌شوند
    const [user] = await this.db
      .select({ tokenVersion: accountUser.tokenVersion })
      .from(accountUser)
      .where(eq(accountUser.id, userId))
      .limit(1);
    if (!user) return;

    await this.db
      .update(accountUser)
      .set({
        tokenVersion: user.tokenVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(accountUser.id, userId));

    // ابطال نشست‌های فعال
    await this.db
      .update(userSession)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSession.userId, userId), isNull(userSession.revokedAt)));
  }

  async setVipRole(userId: string, active: boolean, executor?: any): Promise<void> {
    const db = executor || this.db;
    const [user] = await db.select().from(accountUser).where(eq(accountUser.id, userId)).limit(1);
    if (!user) throw new DomainError(404, "ACCOUNT_NOT_FOUND", "حساب کاربری یافت نشد");
    const nextRole = active ? "vip" : (user.role === "vip" ? "customer" : user.role);
    await db.update(accountUser).set({ role: nextRole, updatedAt: new Date() }).where(eq(accountUser.id, userId));
  }

  async me(userId: string): Promise<AuthUser & { supplierContext?: { supplierId: string; displayName: string; legalName: string } | null; vipContext?: VipContext; totpEnabled?: boolean }> {
    const [user] = await this.db
      .select({
        id: accountUser.id,
        email: accountUser.email,
        role: accountUser.role,
        displayName: accountUser.displayName,
        phone: accountUser.phone,
        status: accountUser.status,
        tokenVersion: accountUser.tokenVersion,
        totpEnabled: accountUser.totpEnabled,
      })
      .from(accountUser)
      .where(eq(accountUser.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedError();

    let supplierContext: { supplierId: string; displayName: string; legalName: string } | null = null;
    if (user.role === "supplier") {
      supplierContext = await this.supplierContext(user.id);
    }

    // Phase 6.3-B — VIP membership context is server-authoritative for every
    // authenticated identity (customers in practice; others resolve to "none").
    const vipContext = await this.vipContext(user.id);

    return { ...(user as AuthUser), supplierContext, vipContext };
  }

  /**
   * Phase 5.9-A — retail customer profile read. Buyer-role accounts only;
   * email is identity and intentionally read-only here.
   */
  async getCustomerProfile(userId: string): Promise<{
    id: string;
    email: string;
    displayName: string | null;
    phone: string | null;
    role: string;
    status: string;
  }> {
    const [user] = await this.db
      .select({
        id: accountUser.id,
        email: accountUser.email,
        role: accountUser.role,
        displayName: accountUser.displayName,
        phone: accountUser.phone,
        status: accountUser.status,
      })
      .from(accountUser)
      .where(eq(accountUser.id, userId))
      .limit(1);
    if (!user) throw new DomainError(404, "CUSTOMER_PROFILE_NOT_FOUND", "customer profile not found");
    if (user.role !== "customer" && user.role !== "vip") {
      throw new DomainError(403, "CUSTOMER_PROFILE_FORBIDDEN", "only customer accounts have a retail profile");
    }
    return { ...user, role: user.role ?? "customer" };
  }

  /**
   * Phase 5.9-A — self-service profile update. displayName/phone only
   * (whitelist: email/role/status are structurally unchangeable here).
   * `undefined` leaves a field unchanged; `null` clears it.
   */
  async updateCustomerProfile(
    userId: string,
    input: { displayName?: unknown; phone?: unknown },
  ): Promise<{
    id: string;
    email: string;
    displayName: string | null;
    phone: string | null;
    role: string;
    status: string;
  }> {
    const current = await this.getCustomerProfile(userId);
    if (current.status !== "active") {
      throw new DomainError(403, "ACCOUNT_SUSPENDED", "حساب کاربری فعال نیست");
    }
    const patch: { displayName?: string | null; phone?: string | null } = {};
    if (input.displayName !== undefined) {
      if (input.displayName === null) {
        patch.displayName = null;
      } else {
        const name = String(input.displayName).trim().slice(0, 160).replace(/[<>]/g, "");
        if (!name) throw new DomainError(400, "CUSTOMER_DISPLAY_NAME_INVALID", "display name must not be empty");
        patch.displayName = name;
      }
    }
    if (input.phone !== undefined) {
      if (input.phone === null) {
        patch.phone = null;
      } else {
        const normalized = String(input.phone).replace(/[\s-]/g, "");
        if (!/^(?:\+98|0098|98|0)?9\d{9}$/.test(normalized)) {
          throw new DomainError(400, "CUSTOMER_PHONE_INVALID", "phone is not a valid Iranian mobile");
        }
        patch.phone = normalized;
      }
    }
    if (Object.keys(patch).length === 0) return current;
    const [updated] = await this.db
      .update(accountUser)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(accountUser.id, userId))
      .returning({
        id: accountUser.id,
        email: accountUser.email,
        role: accountUser.role,
        displayName: accountUser.displayName,
        phone: accountUser.phone,
        status: accountUser.status,
      });
    if (!updated) throw new DomainError(404, "CUSTOMER_PROFILE_NOT_FOUND", "customer profile not found");
    return { ...updated, role: updated.role ?? "customer" };
  }

  async supplierContext(userId: string): Promise<{ supplierId: string; displayName: string; legalName: string } | null> {
    const rows = await this.db
      .select({
        supplierId: supplier.id,
        displayName: supplier.displayName,
        legalName: supplier.legalName,
      })
      .from(supplierMember)
      .innerJoin(supplier, eq(supplierMember.supplierId, supplier.id))
      .where(eq(supplierMember.userId, userId))
      .limit(1);
    if (!rows.length) return null;
    return rows[0];
  }

  /**
   * Phase 6.3-B — server-authoritative VIP membership context. Mirrors the
   * domain's VIP access rule (approved `wholesale_account` + active,
   * unexpired `vip_subscription`) without importing the VIP service (avoids a
   * module cycle); reads the canonical tables directly like `supplierContext`.
   */
  async vipContext(userId: string): Promise<VipContext> {
    // `wholesale_account` is the canonical membership record; `vip_subscription`
    // is the separate plan entitlement that RFQ creation additionally requires
    // (`assertVipAccess`). Capabilities are derived here from canonical state —
    // the frontend never infers them from `status` or role names.
    const [account] = await this.db
      .select({
        id: wholesaleAccount.id,
        memberName: wholesaleAccount.memberName,
        storeName: wholesaleAccount.storeName,
        planName: wholesaleAccount.planName,
        status: wholesaleAccount.status,
        expiresAt: wholesaleAccount.expiresAt,
      })
      .from(wholesaleAccount)
      .where(eq(wholesaleAccount.userId, userId))
      .limit(1);

    const subs = await this.db
      .select({ status: vipSubscription.status, expiresAt: vipSubscription.expiresAt })
      .from(vipSubscription)
      .where(eq(vipSubscription.userId, userId))
      .limit(10);

    const now = Date.now();
    const unexpired = (expiresAt: Date | null | undefined) => !expiresAt || new Date(expiresAt).getTime() > now;
    const approved = account?.status === "approved" && unexpired(account.expiresAt);
    const activeSubscription = subs.some((s) => s.status === "active" && unexpired(s.expiresAt));

    let status: VipContext["status"] = "none";
    if (approved) status = "active";
    else if (account?.status === "pending") status = "pending";
    // rejected / suspended / expired / no-account → "none".

    return {
      status,
      accountId: account?.id ?? null,
      memberName: account?.memberName ?? null,
      storeName: account?.storeName ?? null,
      planName: account?.planName ?? null,
      expiresAt: account?.expiresAt ? new Date(account.expiresAt).toISOString() : null,
      entitlements: {
        catalog: approved,
        rfq: approved && activeSubscription,
        orders: approved,
      },
    };
  }

  private async handleFailedAttempt(user: typeof accountUser.$inferSelect) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    let lockedUntil: Date | null = null;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    }
    await this.db
      .update(accountUser)
      .set({
        failedLoginAttempts: attempts,
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(accountUser.id, user.id));
  }

  private async recordAttempt(userId: string | null, email: string, ip: string | null, success: boolean) {
    try {
      await this.db.insert(loginAttempt).values({
        id: makeId("lat"),
        userId,
        email,
        ip,
        success,
      });
    } catch {
      // ثبت تلاش نباید ورود را بشکند
    }
  }

  private async createSession(userId: string, token: string, ip: string | null, userAgent: string | null) {
    try {
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 روز
      await this.db.insert(userSession).values({
        id: makeId("ses"),
        userId,
        tokenHash,
        expiresAt,
        ip,
        userAgent,
      });
    } catch {
      // نشست اختیاری است؛ خطا نباید ورود را بشکند
    }
  }

  // ── TOTP ────────────────────────────────────────────────────────────────
  async enrollTotp(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = this.totp.generateSecret();
    const otpauthUrl = this.totp.otpauthUrl(secret, email);

    await this.db
      .update(accountUser)
      .set({
        totpSecret: secret,
        // فعال نمی‌شود تا زمانی که کاربر کد را تأیید کند
        updatedAt: new Date(),
      })
      .where(eq(accountUser.id, userId));

    return { secret, otpauthUrl };
  }

  async verifyTotp(userId: string, code: string): Promise<void> {
    const [user] = await this.db
      .select({ totpSecret: accountUser.totpSecret })
      .from(accountUser)
      .where(eq(accountUser.id, userId))
      .limit(1);
    if (!user?.totpSecret) {
      throw new DomainError(400, "TOTP_NOT_ENROLLED", "ابتدا ثبت‌نام دومرحله‌ای را آغاز کنید");
    }
    if (!this.totp.verify(user.totpSecret, code)) {
      throw new DomainError(401, "INVALID_TOTP", "کد دومرحله‌ای نامعتبر است");
    }
    await this.db
      .update(accountUser)
      .set({
        totpEnabled: true,
        totpEnrolledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accountUser.id, userId));
  }

  async disableTotp(userId: string, code?: string): Promise<void> {
    const [user] = await this.db
      .select({ totpSecret: accountUser.totpSecret, totpEnabled: accountUser.totpEnabled })
      .from(accountUser)
      .where(eq(accountUser.id, userId))
      .limit(1);
    if (!user) throw new DomainError(404, "NOT_FOUND", "کاربر یافت نشد");

    // اگر فعال است، برای غیرفعال‌سازی کد لازم است (جلوگیری از حذف تصادفی)
    if (user.totpEnabled) {
      if (!code) throw new DomainError(400, "TOTP_REQUIRED", "برای غیرفعال‌سازی کد لازم است");
      if (!user.totpSecret || !this.totp.verify(user.totpSecret, code)) {
        throw new DomainError(401, "INVALID_TOTP", "کد نامعتبر است");
      }
    }

    await this.db
      .update(accountUser)
      .set({
        totpSecret: null,
        totpEnabled: false,
        totpEnrolledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(accountUser.id, userId));
  }

  /** برای آزمون برابری: صدور توکن لگاسی بدون tv */
  issueLegacyToken(userId: string, role: Role): string {
    return this.verifier.issueLegacy(userId, role);
  }

  /** صدور توکن با نسخه — برای استفادهٔ داخلی و آزمون */
  issueToken(userId: string, role: Role, tokenVersion: number): string {
    return this.verifier.issue(userId, role, tokenVersion);
  }

  verifyToken(token: string) {
    return this.verifier.verify(token);
  }

  cookie(token: string): string {
    return this.verifier.cookie(token, this.config.env === "production");
  }

  clearCookie(): string {
    return this.verifier.clearCookie(this.config.env === "production");
  }
}
