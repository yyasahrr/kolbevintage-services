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
import { desc, eq, and, gte, ilike, or, sql } from "drizzle-orm";
import { ACCOUNT_ROLES, ACCOUNT_STATUSES, accountUser, loginAttempt, supplierMember, supplier, userSession } from "@kolbe/database";
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
  }): Promise<{ user: AuthUser; token: string; supplierContext?: { supplierId: string; displayName: string; legalName: string } | null }> {
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

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      displayName: user.displayName,
      phone: user.phone,
      status: user.status,
      tokenVersion: user.tokenVersion,
    };

    return { user: authUser, token, supplierContext };
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
      .where(and(eq(userSession.userId, userId), eq(userSession.revokedAt, null as any)));
  }

  async me(userId: string): Promise<AuthUser & { supplierContext?: { supplierId: string; displayName: string; legalName: string } | null; totpEnabled?: boolean }> {
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

    return { ...(user as AuthUser), supplierContext };
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

  /**
   * Phase 5.11-A — Retail Admin customer listing (READ seam, owner `auth`).
   *
   * Security: the projection is a fixed SAFE field list. `password_hash`,
   * `salt`, `totp_secret` and session material are structurally absent and
   * never joined back — the D10-style static guard pins this. Keyset on
   * (created_at DESC, id DESC); filters are fixed parameterized conditions.
   */
  async listAccountsForAdmin(input: {
    search?: string | null;
    role?: string | null;
    status?: string | null;
    limit?: number;
    cursor?: [string, string] | null;
  }): Promise<Array<Record<string, unknown>>> {
    const db = this.db as any;
    const limit = input.limit ?? 20;
    const conditions: any[] = [];
    const role = typeof input.role === "string" && input.role !== "" ? input.role : null;
    if (role && !(ACCOUNT_ROLES as readonly string[]).includes(role)) {
      throw new DomainError(400, "ACCOUNT_ROLE_INVALID", `unknown role '${role}'`);
    }
    if (role) conditions.push(eq(accountUser.role, role));
    const status = typeof input.status === "string" && input.status !== "" ? input.status : null;
    if (status && !(ACCOUNT_STATUSES as readonly string[]).includes(status)) {
      throw new DomainError(400, "ACCOUNT_STATUS_INVALID", `unknown status '${status}'`);
    }
    if (status) conditions.push(eq(accountUser.status, status));
    const search = typeof input.search === "string" ? input.search.trim() : "";
    if (search) {
      const term = `%${search.slice(0, 80)}%`;
      conditions.push(
        or(
          ilike(accountUser.email, term),
          ilike(accountUser.displayName, term),
          ilike(accountUser.phone, term),
          eq(accountUser.id, search.slice(0, 64)),
        )!,
      );
    }
    if (input.cursor) {
      conditions.push(sql`(${accountUser.createdAt}, ${accountUser.id}) < (${input.cursor[0]}::timestamptz, ${input.cursor[1]})`);
    }
    const rows = (await db
      .select({
        id: accountUser.id,
        email: accountUser.email,
        displayName: accountUser.displayName,
        phone: accountUser.phone,
        role: accountUser.role,
        status: accountUser.status,
        lastLoginAt: accountUser.lastLoginAt,
        createdAt: accountUser.createdAt,
      })
      .from(accountUser)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(accountUser.createdAt), desc(accountUser.id))
      .limit(limit + 1)) as any[];
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName ?? null,
      phone: row.phone ?? null,
      role: row.role,
      status: row.status,
      lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
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
