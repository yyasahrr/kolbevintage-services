import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Module, MedusaService, model } from "@medusajs/framework/utils";
import AccountUser from "./models/account-user";

export const ACCOUNT_MODULE = "account";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // دو هفته

export type AccountClaims = { sub: string; role: string; exp: number };

function secret(): string {
  return process.env.JWT_SECRET || process.env.MEDUSA_JWT_SECRET || "kolbe-dev-secret-change-me";
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

/**
 * ماژول احراز هویت پلتفرم کلبه.
 * توکنها HMAC امضاشده و بدون نیاز به سرویس بیرونی اعتبارسنجی میشوند.
 * رمزها با scrypt و salt تصادفی ذخیره میشوند.
 */
class AccountModuleService extends MedusaService({ AccountUser }) {
  /** ساخت کاربر جدید؛ در تکراربودن ایمیل خطا میدهد. */
  async registerAccount(input: { email: string; password: string; role?: string; displayName?: string; phone?: string }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.listAccountUsers({ email });
    if (existing.length > 0) throw new Error("این ایمیل قبلاً ثبت شده است.");
    const salt = randomBytes(16).toString("hex");
    const user = await this.createAccountUsers({
      email,
      salt,
      passwordHash: hashPassword(input.password, salt),
      role: (input.role as any) ?? "customer",
      displayName: input.displayName ?? null,
      phone: input.phone ?? null,
    });
    return user;
  }

  /** ورود با ایمیل و رمز؛ در صورت موفقیت توکن نشست برمیگرداند. */
  async loginAccount(email: string, password: string, expectedRole?: string) {
    const [user] = await this.listAccountUsers({ email: email.trim().toLowerCase() });
    if (!user) throw new Error("ایمیل یا رمز عبور درست نیست.");
    const candidate = Buffer.from(hashPassword(password, user.salt), "hex");
    const stored = Buffer.from(user.passwordHash, "hex");
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
      throw new Error("ایمیل یا رمز عبور درست نیست.");
    }
    if (user.status !== "active") throw new Error("این حساب غیرفعال است.");
    if (expectedRole && user.role !== expectedRole) throw new Error("این حساب برای این بخش دسترسی ندارد.");
    return { user, token: this.issueToken(user.id, user.role) };
  }

  issueToken(userId: string, role: string): string {
    const payload: AccountClaims = { sub: userId, role, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret()).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  /** اعتبارسنجی توکن؛ در صورت نامعتبربودن null برمیگرداند. */
  verifyToken(token: string): AccountClaims | null {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", secret()).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as AccountClaims;
      if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
      return claims;
    } catch {
      return null;
    }
  }

  async getAccount(id: string) {
    const [user] = await this.listAccountUsers({ id });
    return user ?? null;
  }

  async changePassword(id: string, password: string) {
    const salt = randomBytes(16).toString("hex");
    await this.updateAccountUsers({ id, salt, passwordHash: hashPassword(password, salt) });
  }
}

// مدل بهصورت داخلی برای MedusaService ثبت شده؛ اکسپورت صریح برای وضوح:
export { AccountUser as AccountUserModel, model };

export default Module(ACCOUNT_MODULE, { service: AccountModuleService });
