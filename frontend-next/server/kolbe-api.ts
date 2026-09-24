import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import { assertDatabaseReady } from "../../packages/database/src/verify";
import { DatabaseNotMigratedError, database, makeId, passwordRecord, rows, transaction } from "./database";
import { ErrorCodes, HttpError, isHttpError } from "./http-error";
import { parseMoneyInput, parseNonNegativeInteger } from "./money-input";
import { consumeRateLimit } from "./rate-limit";
import {
  consumeTryOnTaskQuota,
  consumeTryOnUploadQuota,
} from "./try-on-guard";
import {
  resolveRetailIdempotencyKey,
  translateRetailNestError,
  translateRetailOrderFromNest,
  translateRetailOrderToNest,
} from "./retail-pricing";
import { handlePerfectCorpRequest, isPerfectCorpError } from "./perfect-corp";

/**
 * CORS — فاز ۲: محاسبه per-request (D36).
 *
 * قبلاً همیشه `access-control-allow-origin: *` برگردانده می‌شد که با کوکی‌های
 * HttpOnly (نیازمند `credentials`) ناسازگار و برای API مالی ناامن است.
 * حالا فقط مبدأهای مجاز از `KOLBE_ALLOWED_ORIGINS` (با کاما جدا شده) اکو می‌شوند.
 *
 * - در توسعه، اگر متغیر تنظیم نشده باشد، برای سازگاری با پوسته‌های قدیمی Vite مقدار `*` می‌ماند.
 * - در تولید، اگر تنظیم نشده باشد هیچ هدر CORS صادر نمی‌شود؛ یعنی فقط درخواست‌های
 *   same-origin (فروشگاه Next.js) کار می‌کنند که رفتار مورد انتظار است.
 * - فاز ۲: CORS_HEADERS دیگر در زمان import محاسبه نمی‌شود؛ هر درخواست
 *   origin خودش را می‌گیرد (D36).
 */
function allowedOrigins(): string[] {
  return (process.env.KOLBE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();
  const base: Record<string, string> = {
    "access-control-allow-headers": "content-type, authorization, idempotency-key",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-max-age": "600",
  };
  function isAllowed(o: string): boolean {
    if (allowed.includes(o)) return true;
    return allowed.some((a) => {
      if (a === "*") return true;
      if (a === o) return true;
      if (a.startsWith("https://*.")) {
        const suffix = a.slice("https://*.".length);
        try {
          const url = new URL(o);
          return url.hostname === suffix || url.hostname.endsWith("." + suffix);
        } catch { return false; }
      }
      if (a.startsWith("http://*.")) {
        const suffix = a.slice("http://*.".length);
        try {
          const url = new URL(o);
          return url.hostname === suffix || url.hostname.endsWith("." + suffix);
        } catch { return false; }
      }
      return false;
    });
  }
  if (allowed.length) {
    if (origin && isAllowed(origin)) {
      return { ...base, "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "origin" };
    }
    return base;
  }
  if (process.env.NODE_ENV === "production") return base;
  return { ...base, "access-control-allow-origin": "*" };
}

type Claims = { sub: string; role: string; exp: number; tv?: number };
type Json = Record<string, any>;


const HERO_VIDEO_SETTING_KEY = "storefront-hero-video";
const HERO_VIDEO_URL = "/store/kolbe/site/hero-video";
const BANNER_VIDEO_SETTING_KEY = "storefront-banner-video";
const BANNER_VIDEO_URL = "/store/kolbe/site/banner-video";

function embeddedHeroVideo(settings: any): string | null {
  const value = settings?.heroStudio?.heroVideo;
  return typeof value === "string" && /^data:video\//i.test(value) ? value : null;
}

function embeddedBannerVideo(settings: any): string | null {
  const value = settings?.builder?.banner?.media;
  return settings?.builder?.banner?.mediaType === "video" && typeof value === "string" && /^data:video\//i.test(value) ? value : null;
}

function withoutEmbeddedHeroVideo(settings: any) {
  if (!embeddedHeroVideo(settings)) return settings;
  return {
    ...settings,
    heroStudio: { ...settings.heroStudio, heroVideo: HERO_VIDEO_URL },
  };
}


function withoutEmbeddedVideos(settings: any) {
  const heroSafe = withoutEmbeddedHeroVideo(settings);
  if (!embeddedBannerVideo(settings)) return heroSafe;
  return {
    ...heroSafe,
    builder: {
      ...heroSafe.builder,
      banner: { ...heroSafe.builder?.banner, media: BANNER_VIDEO_URL },
    },
  };
}

function parseVideoDataUrl(dataUrl: string) {
  // Avoid a capturing regexp over multi-megabyte Base64 strings. V8 may
  // overflow its regexp stack before decoding a perfectly valid video.
  if (!dataUrl.toLowerCase().startsWith("data:video/")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const metadata = dataUrl.slice(5, comma);
  const separator = metadata.indexOf(";");
  const declaredMime = (separator < 0 ? metadata : metadata.slice(0, separator)).toLowerCase();
  if (!metadata.toLowerCase().includes(";base64") || !declaredMime.startsWith("video/")) return null;
  const mime = declaredMime === "video/quicktime" ? "video/mp4" : declaredMime;
  return { mime, bytes: Buffer.from(dataUrl.slice(comma + 1), "base64") };
}

/**
 * اعتبارسنجی سمت سرور فایل‌های آپلودی.
 *
 * قاعدهٔ حاکم: «All uploads must be validated server-side» (PROMPT 0).
 * ممیزی (D9) نشان داد ویدیوهای سایت‌ساز به‌صورت Data-URL چندمگابایتی در
 * `site_setting` ذخیره می‌شوند بدون هیچ بررسی اندازه/نوع سمت سرور.
 * این تابع حداقلِ لازم را اضافه می‌کند تا یک مدیر (یا توکن دزدیده‌شدهٔ مدیر)
 * نتواند دیتابیس را با فایل حجیم/نامعتبر پر کند.
 *
 * هدف نهایی (فاز ۶): آپلود مستقیم به S3/ParsPack با URL امضاشده و
 * `files` table. این تابع تا آن زمان نقش نگهبان را دارد.
 */
const MAX_EMBEDDED_VIDEO_BYTES = 25 * 1024 * 1024;
const ALLOWED_EMBEDDED_VIDEO_MIME = new Set(["video/mp4", "video/webm"]);

function validateEmbeddedVideo(dataUrl: string): number {
  const parsed = parseVideoDataUrl(dataUrl);
  if (!parsed) throw new HttpError(422, "INVALID_VIDEO_FORMAT");
  if (!ALLOWED_EMBEDDED_VIDEO_MIME.has(parsed.mime)) throw new HttpError(422, "UNSUPPORTED_VIDEO_TYPE");
  if (parsed.bytes.length > MAX_EMBEDDED_VIDEO_BYTES) throw new HttpError(413, "VIDEO_TOO_LARGE");
  return parsed.bytes.length;
}

function videoStream(bytes: Uint8Array, start = 0, end = bytes.length - 1) {
  const chunkSize = 64 * 1024;
  let offset = start;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset > end) {
        controller.close();
        return;
      }
      const nextOffset = Math.min(offset + chunkSize, end + 1);
      // Buffer is a Uint8Array subclass in Node. Copying each small chunk to a
      // plain Uint8Array prevents undici from recursively normalising Buffer
      // views for large videos (which otherwise can overflow the call stack).
      controller.enqueue(Uint8Array.from(bytes.subarray(offset, nextOffset)));
      offset = nextOffset;
    },
  });
}

/** نام کوکی نشست. توکن حاوی نقش است، پس یک کوکی برای همهٔ نقش‌ها کافی است. */
export const SESSION_COOKIE = "kolbe_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

let warnedAboutDevSecret = false;

const sessionSecret = () => {
  const secret = process.env.KOLBE_SESSION_SECRET ?? process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new HttpError(500, ErrorCodes.SESSION_SECRET_MISSING);
  }
  if (secret) return secret;
  if (!warnedAboutDevSecret) {
    warnedAboutDevSecret = true;
    console.warn(
      "[kolbe] KOLBE_SESSION_SECRET تنظیم نشده است؛ مقدار توسعه استفاده می‌شود. " +
        "در تولید برنامه بالا نمی‌آید تا از جعل توکن جلوگیری شود.",
    );
  }
  return "kolbe-dev-secret-change-me";
};


/** ── TOTP ────────────────────────────────────────────────────────────────
 * پیاده‌سازی حداقلی TOTP برای enrolment — مشابه NestJS TotpService
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32EncodeTotp(buffer: Buffer): string {
  let bits = 0; let value = 0; let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]; bits += 8;
    while (bits >= 5) { output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
function base32DecodeTotp(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function intToBufferTotp(counter: number): Buffer {
  const buf = Buffer.alloc(8); buf.writeUInt32BE(0,0); buf.writeUInt32BE(counter,4); return buf;
}
function totpGenerateCode(secret: string, timeStep?: number): string {
  const step = timeStep ?? Math.floor(Date.now() / 1000 / 30);
  const key = base32DecodeTotp(secret);
  const counter = intToBufferTotp(step);
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset+1] & 0xff) << 16) | ((hmac[offset+2] & 0xff) << 8) | (hmac[offset+3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}
function totpVerify(secret: string, token: string, window = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const current = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) if (totpGenerateCode(secret, current + i) === token) return true;
  return false;
}
function totpSecretRandom(): string {
  return base32EncodeTotp(randomBytes(20));
}
function totpOtpauthUrl(secret: string, email: string, issuer = "Kolbe Vintage"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}


function issueToken(userId: string, role: string, tokenVersion: number = 0) {
  const payload: Claims = { sub: userId, role, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, tv: tokenVersion };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token: string): Claims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (!claims.sub || !claims.role || typeof claims.exp !== "number") return null;
    if (claims.exp * 1000 <= Date.now()) return null;
    if (claims.tv !== undefined && typeof claims.tv !== "number") return null;
    return claims;
  } catch {
    return null;
  }
}

function readCookie(req: NextRequest, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function claimsFrom(req: NextRequest): Claims | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return verifyToken(bearer);
  const cookie = readCookie(req, SESSION_COOKIE);
  return cookie ? verifyToken(cookie) : null;
}

async function assertTokenVersion(claims: Claims): Promise<Claims> {
  // فاز ۲: بررسی نسخهٔ توکن و وضعیت حساب در دیتابیس
  try {
    const user = (await rows<any>("SELECT id, role, status, token_version FROM account_user WHERE id=$1 LIMIT 1", [claims.sub]))[0];
    if (!user) throw new HttpError(401, "UNAUTHORIZED");
    if (user.status !== "active") throw new HttpError(403, "ACCOUNT_SUSPENDED");
    const tv = claims.tv;
    if (tv !== undefined) {
      if (tv !== Number(user.token_version)) throw new HttpError(401, "UNAUTHORIZED");
    } else {
      if (Number(user.token_version) !== 0) throw new HttpError(401, "UNAUTHORIZED");
    }
    if (user.role !== claims.role) throw new HttpError(401, "UNAUTHORIZED");
    return claims;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "UNAUTHORIZED");
  }
}

async function requireRole(req: NextRequest, role: string) {
  const claims = claimsFrom(req);
  if (!claims || claims.role !== role) throw new HttpError(401, "UNAUTHORIZED");
  return assertTokenVersion(claims);
}

async function requireAnyRole(req: NextRequest, roles: string[]) {
  const claims = claimsFrom(req);
  if (!claims || !roles.includes(claims.role)) throw new HttpError(401, "UNAUTHORIZED");
  return assertTokenVersion(claims);
}

function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearedSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function response(reqOrData: NextRequest | unknown, dataOrStatus?: unknown, statusOrHeaders?: number | Record<string, string>, extraHeaders?: Record<string, string>) {
  // فاز ۲: سازگار با هر دو امضا — قدیمی response(data, status, headers) و جدید response(req, data, status, headers)
  let req: NextRequest | null = null;
  let data: unknown;
  let status = 200;
  let headers: Record<string, string> = {};
  if (reqOrData && typeof (reqOrData as any).headers?.get === "function") {
    req = reqOrData as NextRequest;
    data = dataOrStatus;
    if (typeof statusOrHeaders === "number") {
      status = statusOrHeaders;
      headers = extraHeaders ?? {};
    } else {
      headers = (statusOrHeaders as Record<string, string>) ?? {};
    }
  } else {
    data = reqOrData;
    if (typeof dataOrStatus === "number") {
      status = dataOrStatus;
      headers = (statusOrHeaders as Record<string, string>) ?? {};
    } else if (typeof dataOrStatus === "object" && dataOrStatus !== null) {
      // امضای قدیمی: response(data, status, headers) — اما dataOrStatus می‌تواند status باشد
      // تشخیص: اگر dataOrStatus عدد است status، وگرنه headers
      if (typeof statusOrHeaders === "object") {
        status = 200;
        headers = statusOrHeaders as Record<string, string>;
        // dataOrStatus در این حالت status نیست، بلکه دومین آرگومان قدیمی که status است
        // در فراخوانی‌های قدیمی: response(data, 201) => dataOrStatus=201
        // پس اگر dataOrStatus عدد است، status است
        if (typeof dataOrStatus === "number") {
          status = dataOrStatus;
          headers = (statusOrHeaders as Record<string, string>) ?? {};
        } else {
          // response(data, status, headers) با status عددی
          // ما قبلاً data را گرفتیم، حالا باید status را از dataOrStatus بخوانیم اگر عدد است
          // اما این شاخه برای response(data, status) نیست
        }
      }
    }
    // بازسازی منطق قدیمی ساده: اگر dataOrStatus عدد است status
    if (typeof dataOrStatus === "number") {
      status = dataOrStatus;
      headers = (statusOrHeaders as Record<string, string>) ?? {};
    } else if (typeof dataOrStatus === "object" && dataOrStatus !== null && !Array.isArray(dataOrStatus)) {
      // ممکن است dataOrStatus همان status نباشد — در فراخوانی response(data, 201) دومین آرگومان عدد است
      // پس این شاخه نباید اجرا شود
    }
    // برای امضای قدیمی response(data, status, headers):
    if (typeof dataOrStatus === "number" && typeof statusOrHeaders === "object") {
      data = reqOrData;
      status = dataOrStatus;
      headers = statusOrHeaders as Record<string, string>;
    } else if (typeof reqOrData !== "object" || (reqOrData as any).headers?.get) {
      // already handled
    } else {
      // قدیمی: response(data, status, extraHeaders)
      // اگر سه آرگومان: data, status, headers
      // ما data را داریم، status را اگر dataOrStatus عدد است، و headers را اگر statusOrHeaders شیء است
      if (typeof dataOrStatus === "number") {
        status = dataOrStatus;
        headers = (statusOrHeaders as Record<string, string>) ?? {};
      } else {
        // فقط یک آرگومان
        data = reqOrData;
        status = 200;
        headers = {};
      }
    }
  }
  const origin = req?.headers.get("origin") ?? null;
  const cors = corsHeadersFor(origin);
  return Response.json(data, { status, headers: { ...cors, ...headers } });
}

function responseWithoutReq(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...corsHeadersFor(null), ...extraHeaders } });
}


function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

function checkOrigin(req: NextRequest) {
  const method = String(req.method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const allowed = allowedOrigins();
  if (allowed.length === 0) {
    if (process.env.NODE_ENV !== "production") return;
    throw new HttpError(403, "FORBIDDEN_ORIGIN");
  }
  if (!allowed.includes(origin)) {
    // پشتیبانی wildcard ساده
    const ok = allowed.some((a) => {
      if (a === "*") return true;
      if (a === origin) return true;
      if (a.startsWith("https://*.")) {
        const suffix = a.slice("https://*.".length);
        try {
          const url = new URL(origin);
          return url.hostname === suffix || url.hostname.endsWith(`.${suffix}`);
        } catch { return false; }
      }
      return false;
    });
    if (!ok) throw new HttpError(403, "FORBIDDEN_ORIGIN");
  }
}


/**
 * ثبت رکورد حسابرسی — قاعدهٔ «Admin operations must be auditable».
 *
 * این تابع باید **داخل همان تراکنش** تغییر دامنه صدا زده شود تا اگر تغییر rollback شد،
 * رکورد حسابرسی هم ثبت نشود (و برعکس). جدول `audit_log` در سطح دیتابیس فقط-افزودنی است.
 */
async function appendAudit(
  client: PoolClient,
  entry: {
    actorId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
) {
  const protectedEntityTypes = new Set([
    "wholesale_order",
    "wholesale_order_item",
    "purchase_order",
    "purchase_order_item",
    "wholesale_request",
    "product_variant_inventory",
    "inventory_reservation",
    "inventory_ledger",
    "order_status_history",
    "order_event",
    "fulfillment_exception",
    "fulfillment_replacement_request",
  ]);
  if (protectedEntityTypes.has(entry.entityType)) {
    return;
  }
  await client.query(
    `INSERT INTO audit_log (id,actor_id,actor_role,action,entity_type,entity_id,before,after,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      makeId("aud"),
      entry.actorId,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
    ],
  );
}

/**
 * عدم‌تکرار (Idempotency) — قاعدهٔ «All external callbacks/webhooks must be idempotent».
 *
 * کلید از هدر `Idempotency-Key` خوانده می‌شود. اگر همان کلید قبلاً سفارش ساخته باشد،
 * به‌جای ساخت سفارش دوم، همان سفارش برگردانده می‌شود (پاسخ ۲۰۰ به‌جای ۲۰۱).
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function readIdempotencyKey(req: NextRequest): string | null {
  const raw = req.headers.get("idempotency-key");
  if (!raw) return null;
  const key = raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new HttpError(422, "INVALID_IDEMPOTENCY_KEY");
  }
  return key;
}

async function jsonBody(req: NextRequest): Promise<Json> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function passwordMatches(password: string, salt: string, stored: string) {
  const candidate = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const target = Buffer.from(stored, "hex");
  return candidate.length === target.length && timingSafeEqual(candidate, target);
}

async function supplierContext(userId: string) {
  return (await rows<any>(
    `SELECT s.id AS "supplierId", s.display_name AS "displayName", s.legal_name AS "legalName"
     FROM supplier_member m JOIN supplier s ON s.id=m.supplier_id
     WHERE m.user_id=$1 AND s.status='approved' LIMIT 1`,
    [userId],
  ))[0] ?? null;
}

/** آیا این رکورد عضویت، «فعال و معتبر» است؟ (منبع یکتای تصمیم برای دسترسی عمده) */
function isAccountActive(account: any): boolean {
  if (!account || account.status !== "approved") return false;
  if (!account.expires_at) return true;
  return new Date(account.expires_at).getTime() > Date.now();
}

async function activeAccount(userId: string) {
  return (await rows<any>(
    `SELECT * FROM wholesale_account WHERE user_id=$1 AND status='approved'
     AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`,
    [userId],
  ))[0] ?? null;
}

async function catalog(where = "", values: unknown[] = []) {
  // Phase 3.8 canonical — product is source of truth
  const products = await rows<any>(
    `SELECT p.*, so.wholesale_price, so.seller_id, s.supplier_id FROM product p
     LEFT JOIN seller_offer so ON so.product_id=p.id AND so.status='active'
     LEFT JOIN seller s ON s.id=so.seller_id
     ${where} ORDER BY p.updated_at DESC`, values,
  );
  if (!products.length) return [];
  const variants = await rows<any>(
    `SELECT v.*, i.on_hand, i.reserved, v.attributes FROM product_variant v
     LEFT JOIN product_variant_inventory i ON i.variant_id=v.id WHERE v.product_id=ANY($1::text[])`,
    [products.map((product: any) => product.id)],
  );
  const byProduct = new Map<string, any[]>();
  for (const variant of variants) {
    const attrs = variant.attributes || {};
    const item = {
      id: variant.id, sku: variant.sku, color: attrs.color || null, color_hex: attrs.color_hex || null,
      size: attrs.size || null, attributes: attrs,
      inventory: { on_hand: variant.on_hand ?? 0, reserved: variant.reserved ?? 0 },
    };
    byProduct.set(variant.product_id, [...(byProduct.get(variant.product_id) ?? []), item]);
  }
  return products.map((product: any) => ({
    id: product.id, supplier_id: product.supplier_id || null, seller_id: product.seller_id || null,
    name: product.name, sku: product.sku, slug: product.slug,
    category: product.category_id, description: product.description, wholesale_price: Number(product.wholesale_price ?? 0),
    image_url: null, status: product.status, updated_at: product.updated_at,
    product_variants: byProduct.get(product.id) ?? [],
  }));
}

async function purchaseOrders(supplierId?: string, wholesaleOrderId?: string) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (supplierId) { values.push(supplierId); conditions.push(`supplier_id=$${values.length}`); }
  if (wholesaleOrderId) { values.push(wholesaleOrderId); conditions.push(`wholesale_order_id=$${values.length}`); }
  const orders = await rows<any>(
    `SELECT * FROM purchase_order ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC`, values,
  );
  const items = orders.length ? await rows<any>(
    `SELECT * FROM purchase_order_item WHERE purchase_order_id=ANY($1::text[])`, [orders.map((order) => order.id)],
  ) : [];
  return orders.map((order) => ({
    id: order.id, order_code: order.order_code, status: order.status, supplier_id: order.supplier_id,
    wholesale_order_id: order.wholesale_order_id, due_date: order.due_date, total_amount: Number(order.total_amount),
    tracking_code: order.tracking_code, shipped_at: order.shipped_at, delivered_at: order.delivered_at,
    created_at: order.created_at,
    purchase_order_items: items.filter((item) => item.purchase_order_id === order.id).map((item) => ({
      id: item.id, product_name: item.product_name, sku: item.sku, variant_id: item.variant_id,
      quantity: item.quantity, unit_price: Number(item.unit_price),
    })),
  }));
}

async function wholesaleOrders(accountId?: string) {
  const orders = await rows<any>(
    `SELECT * FROM wholesale_order ${accountId ? "WHERE account_id=$1" : ""} ORDER BY created_at DESC`,
    accountId ? [accountId] : [],
  );
  const items = orders.length ? await rows<any>(
    `SELECT * FROM wholesale_order_item WHERE order_id=ANY($1::text[])`, [orders.map((order) => order.id)],
  ) : [];
  return orders.map((order) => ({
    id: order.id, order_code: order.order_code, status: order.status, total_amount: Number(order.total_amount),
    total_units: order.total_units, created_at: order.created_at, account_id: order.account_id,
    wholesale_order_items: items.filter((item) => item.order_id === order.id).map((item) => ({
      id: item.id, product_id: item.product_id, variant_id: item.variant_id, product_name: item.product_name,
      sku: item.sku, quantity: item.quantity, unit_price: Number(item.unit_price),
    })),
  }));
}

async function updatePurchaseOrder(_client: PoolClient, _id: string, _status: string, _trackingCode?: string) {
  throw new HttpError(410, "LEGACY_MUTATION_DISABLED");
}

function logShape(log: any) {
  return {
    id: log.id, level: log.level, source: log.source, eventType: log.event_type, message: log.message,
    errorName: log.error_name, stack: log.stack, fingerprint: log.fingerprint, status: log.status,
    httpMethod: log.http_method, path: log.path, httpStatus: log.http_status, durationMs: log.duration_ms,
    requestId: log.request_id, actorId: log.actor_id, actorRole: log.actor_role, ip: log.ip,
    userAgent: log.user_agent, environment: log.environment, release: log.release, metadata: log.metadata,
    firstSeenAt: log.first_seen_at, lastSeenAt: log.last_seen_at, occurrenceCount: log.occurrence_count,
    resolvedAt: log.resolved_at, resolvedBy: log.resolved_by, resolutionNote: log.resolution_note,
    createdAt: log.created_at,
  };
}

/**
 * Phase 4.5 — Legacy Mutation Kill Switch
 * When LEGACY_MUTATION_DISABLED=true, all legacy wholesale mutations are blocked.
 * Rollback strategy must NOT be turning direct SQL back on — rollback = revert Nest version via Nginx.
 */
function assertLegacyMutationsEnabled() {
  if (process.env.LEGACY_MUTATION_DISABLED === "true") {
    throw new HttpError(410, "LEGACY_MUTATION_DISABLED");
  }
}

/**
 * Phase 4.5 — Secure HttpOnly cookie forwarding to Nest canonical APIs
 * No localStorage bearer, no fake token, no user-controlled identity forwarding.
 * Nest remains authority via Claims.sub from kolbe_session cookie.
 */
async function forwardToNest(
  req: import("next/server").NextRequest,
  method: string,
  nestPath: string,
  body?: any,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const base =
    process.env.KOLBE_API_INTERNAL_URL ||
    process.env.KOLBE_NEST_API_URL ||
    "http://localhost:4000/api/v1";
  const url = `${base.replace(/\/$/, "")}/${nestPath.replace(/^\//, "")}`;
  const cookie = req.headers.get("cookie") || "";
  const idempotencyKey =
    req.headers.get("idempotency-key") ||
    req.headers.get("Idempotency-Key") ||
    (body as any)?.idempotencyKey ||
    "";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie,
  };
  const authorization = req.headers.get("authorization");
  if (authorization) headers.authorization = authorization;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const requestId = req.headers.get("x-request-id") || req.headers.get("x-correlation-id");
  if (requestId) headers["x-request-id"] = requestId;
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  const compatibilityToken = req.headers.get("x-kolbe-internal-token");
  if (compatibilityToken) headers["x-kolbe-internal-token"] = compatibilityToken;
  Object.assign(headers, extraHeaders);

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, headers: res.headers } as any;
}

/** Phase 5.12-A: intercepted before legacy read handlers. Nest owns all
 * validation, authorization, persistence, transitions and domain audit. */
async function proxyCanonicalWrite(req: NextRequest, nestPath: string, body: Json) {
  let result: { status: number; data: any; headers?: Headers };
  try {
    result = await forwardToNest(req, req.method, nestPath, body) as any;
  } catch {
    throw new HttpError(503, "CANONICAL_API_UNAVAILABLE", "سرویس اصلی در دسترس نیست");
  }
  const headers: Record<string, string> = {};
  const setCookie = result.headers?.get("set-cookie");
  if (setCookie) headers["set-cookie"] = setCookie;
  if (nestPath === "auth/logout" && result.status === 401) {
    return response(req, { ok: true }, 200, { "set-cookie": clearedSessionCookie() });
  }
  const compatibilityToken = result.headers?.get("x-kolbe-session-token");
  const data = compatibilityToken && result.data && typeof result.data === "object"
    ? { ...result.data, token: compatibilityToken }
    : result.data;
  const status = nestPath.startsWith("auth/") && nestPath !== "auth/register"
    && result.status >= 200 && result.status < 300 ? 200 : result.status;
  return response(req, data, status, headers);
}

function compatibilityVideoResponse(req: NextRequest, dataUrl: string | null | undefined): Response {
  const video = dataUrl ? parseVideoDataUrl(dataUrl) : null;
  if (!video) throw new HttpError(404, "HERO_VIDEO_NOT_FOUND");
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const commonHeaders = { ...corsHeadersFor(req.headers.get("origin")), "content-type": video.mime,
    "accept-ranges": "bytes", "cache-control": "public, max-age=3600" };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = Math.min(range[2] ? Number(range[2]) : video.bytes.length - 1, video.bytes.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
      return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${video.bytes.length}` } });
    }
    return new Response(videoStream(video.bytes, start, end), { status: 206, headers: { ...commonHeaders,
      "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${video.bytes.length}` } });
  }
  return new Response(videoStream(video.bytes), { headers: { ...commonHeaders, "content-length": String(video.bytes.length) } });
}

async function cutOverLegacyBusinessRead(req: NextRequest, path: string): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const targets: Record<string, string> = {
    "auth/me": "auth/me", "me": "auth/me",
    "supplier/session": "compat/supplier/session", "supplier/products": "compat/supplier/products",
    "supplier/orders": "compat/supplier/orders", "supplier/rfqs": "compat/supplier/rfqs",
    "supplier/tickets": "compat/supplier/tickets", "wholesale/account": "compat/wholesale/account",
    "wholesale/products": "compat/wholesale/products", "wholesale/orders": "compat/wholesale/orders",
    "admin/accounts": "compat/admin/accounts", "admin/supplier-applications": "compat/admin/supplier-applications",
    "admin/audit-logs": "compat/admin/audit-logs", "admin/suppliers": "compat/admin/suppliers",
    "admin/catalog": "compat/admin/catalog", "admin/purchase-orders": "compat/admin/purchase-orders",
    "admin/orders": "compat/admin/orders", "admin/rfqs": "compat/admin/rfqs",
    "admin/tickets": "compat/admin/tickets", "site/settings": "compat/storefront/site",
    "site/hero-video": "compat/storefront/site", "site/banner-video": "compat/storefront/site",
  };
  const target = targets[path];
  if (!target) return null;
  const query = new URL(req.url).search;
  let result: { status: number; data: any };
  try {
    result = await forwardToNest(req, "GET", `${target}${query}`, undefined) as any;
  } catch {
    throw new HttpError(503, "CANONICAL_API_UNAVAILABLE", "سرویس اصلی در دسترس نیست");
  }
  if (result.status < 200 || result.status >= 300) return response(req, result.data, result.status);
  if (path === "auth/me") return response(req, result.data.user ?? result.data);
  if (path === "me") {
    const user = result.data.user ?? result.data;
    return response(req, { id: user.id, name: user.name ?? user.email.split("@")[0], phone: user.phone ?? "—", email: user.email });
  }
  if (path === "site/settings") {
    const settings = withoutEmbeddedVideos(result.data.settings ?? null);
    return response(req, { settings, updatedAt: result.data.updatedAt ?? null });
  }
  if (path === "site/hero-video" || path === "site/banner-video") {
    const isBanner = path === "site/banner-video";
    const dedicated = isBanner ? result.data.bannerVideo?.dataUrl : result.data.heroVideo?.dataUrl;
    const embedded = isBanner ? embeddedBannerVideo(result.data.settings) : embeddedHeroVideo(result.data.settings);
    return compatibilityVideoResponse(req, dedicated ?? embedded);
  }
  return response(req, result.data);
}

async function cutOverLegacyBusinessWrite(req: NextRequest, path: string): Promise<Response | null> {
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  const exact: Record<string, string> = {
    "POST auth/register": "auth/register",
    "POST auth/login": "auth/login",
    "POST auth/logout": "auth/logout",
    "POST auth/totp/enroll": "auth/totp/enroll",
    "POST auth/totp/verify": "auth/totp/verify",
    "POST auth/totp/disable": "auth/totp/disable",
    "POST supplier/auth/login": "auth/supplier/login",
  };
  const target = exact[`${method} ${path}`];
  if (target) {
    const body = await jsonBody(req);
    const internalToken = process.env.KOLBE_INTERNAL_API_TOKEN?.trim();
    const headers = new Headers(req.headers);
    if (internalToken) headers.set("x-kolbe-internal-token", internalToken);
    const forwarded = new Request(req.url, { method: req.method, headers }) as NextRequest;
    return proxyCanonicalWrite(forwarded, target, body);
  }

  if (method === "POST" && path === "supplier/tickets") {
    const body = await jsonBody(req);
    const knownCategories = new Set([
      "ORDER", "PAYMENT", "SHIPPING", "RETURN", "REFUND", "MEMBERSHIP",
      "WHOLESALE", "SUPPLIER", "PRODUCT", "QUALITY", "CUSTOM_PRODUCTION",
      "FINANCE", "SETTLEMENT", "ACCOUNT", "OTHER",
    ]);
    const requestedCategory = String(body.category ?? "").trim().toUpperCase();
    const requestedPriority = String(body.priority ?? "normal").trim().toUpperCase();
    return proxyCanonicalWrite(req, "supplier/support/cases", {
      subject: body.subject,
      category: knownCategories.has(requestedCategory) ? requestedCategory : "SUPPLIER",
      priority: ["LOW", "NORMAL", "HIGH", "URGENT"].includes(requestedPriority)
        ? requestedPriority
        : "NORMAL",
      initialMessage: body.message,
    });
  }

  let match = path.match(/^supplier\/orders\/([^/]+)\/status$/);
  if (method === "POST" && match) {
    const body = await jsonBody(req);
    const action = mapLegacySupplierStatusToNest(String(body.status ?? ""));
    if (!action) throw new HttpError(422, "INVALID_STATUS");
    return proxyCanonicalWrite(req, `supplier/orders/${encodeURIComponent(match[1])}/${action}`, body);
  }
  match = path.match(/^admin\/orders\/([^/]+)\/cancel$/);
  if (method === "POST" && match) return proxyCanonicalWrite(req, `admin/wholesale/orders/${encodeURIComponent(match[1])}/cancel`, await jsonBody(req));
  return null;
}

function mapLegacySupplierStatusToNest(status: string): string | null {
  const map: Record<string, string> = {
    confirmed: "confirm",
    preparing: "start-preparation",
    ready: "ready",
    shipped: "dispatch",
    delivered: "deliver",
    cancelled: "cancel",
  };
  return map[status] || null;
}

async function handleAuth(req: NextRequest, path: string) {
  const body = await jsonBody(req);
  const ip = clientIp(req);
  if (path === "auth/register") {
    if (!body.email || !body.password || String(body.password).length < 8) throw new HttpError(422, "INVALID_INPUT");
    const { salt, passwordHash } = passwordRecord(String(body.password));
    try {
      const [user] = await rows<any>(
        `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone,token_version,failed_login_attempts)
         VALUES ($1,$2,$3,$4,'customer',$5,$6,0,0) RETURNING id,email,role,display_name,phone,token_version`,
        [makeId("usr"), String(body.email).trim().toLowerCase(), passwordHash, salt, body.name?.trim() || null, body.phone?.trim() || null],
      );
      const token = issueToken(user.id, user.role, Number(user.token_version ?? 0));
      // نشست اختیاری — خطا نباید ثبت‌نام را بشکند
      try {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        await rows(`INSERT INTO user_session (id,user_id,token_hash,expires_at,ip,user_agent) VALUES ($1,$2,$3,$4,$5,$6)`, [makeId("ses"), user.id, tokenHash, new Date(Date.now() + 14*24*60*60*1000), ip, req.headers.get("user-agent") ?? null]);
      } catch {}
      return response(req, { user: { id: user.id, email: user.email, role: user.role, name: user.display_name, phone: user.phone } }, 201, { "set-cookie": sessionCookie(token) });
    } catch (error: any) {
      if (error?.code === "23505") throw new HttpError(409, "EMAIL_EXISTS");
      throw error;
    }
  }
  if (path === "auth/login") {
    if (!body.email || !body.password) throw new HttpError(422, "INVALID_INPUT");
    const email = String(body.email).trim().toLowerCase();
    const user = (await rows<any>("SELECT * FROM account_user WHERE email=$1 LIMIT 1", [email]))[0];
    const attemptId = makeId("lat");
    if (!user) {
      try { await rows(`INSERT INTO login_attempt (id,email,ip,success) VALUES ($1,$2,$3,false)`, [attemptId, email, ip]); } catch {}
      throw new HttpError(401, "INVALID_CREDENTIALS");
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new HttpError(423, "ACCOUNT_LOCKED");
    }
    if (user.status !== "active") throw new HttpError(403, "ACCOUNT_SUSPENDED");
    if (!passwordMatches(String(body.password), user.salt, user.password_hash)) {
      const attempts = Number(user.failed_login_attempts ?? 0) + 1;
      let lockedUntil: Date | null = null;
      if (attempts >= 5) lockedUntil = new Date(Date.now() + 15*60*1000);
      try { await rows(`UPDATE account_user SET failed_login_attempts=$2, locked_until=$3, updated_at=now() WHERE id=$1`, [user.id, attempts, lockedUntil]); } catch {}
      try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,false)`, [makeId("lat"), user.id, email, ip]); } catch {}
      throw new HttpError(401, "INVALID_CREDENTIALS");
    }
    if (body.role && body.role !== user.role) {
      try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,false)`, [makeId("lat"), user.id, email, ip]); } catch {}
      throw new HttpError(403, "ROLE_MISMATCH");
    }
    if (user.totp_enabled) {
      if (!body.totpCode) throw new HttpError(401, "TOTP_REQUIRED");
      if (!user.totp_secret || !totpVerify(user.totp_secret, String(body.totpCode))) {
        try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,false)`, [makeId("lat"), user.id, email, ip]); } catch {}
        throw new HttpError(401, "INVALID_TOTP");
      }
    }
    try { await rows(`UPDATE account_user SET failed_login_attempts=0, locked_until=NULL, last_login_at=now(), updated_at=now() WHERE id=$1`, [user.id]); } catch {}
    try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,true)`, [makeId("lat"), user.id, email, ip]); } catch {}
    const token = issueToken(user.id, user.role, Number(user.token_version ?? 0));
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await rows(`INSERT INTO user_session (id,user_id,token_hash,expires_at,ip,user_agent) VALUES ($1,$2,$3,$4,$5,$6)`, [makeId("ses"), user.id, tokenHash, new Date(Date.now() + 14*24*60*60*1000), ip, req.headers.get("user-agent") ?? null]);
    } catch {}
    return response(req, 
      {
        token,
        user: { id: user.id, email: user.email, role: user.role, name: user.display_name, phone: user.phone },
      },
      200,
      { "set-cookie": sessionCookie(token) },
    );
  }
  if (path === "auth/logout" && req.method === "POST") {
    const claims = claimsFrom(req);
    if (claims) {
      try {
        const u = (await rows<any>("SELECT token_version FROM account_user WHERE id=$1 LIMIT 1", [claims.sub]))[0];
        if (u) {
          await rows(`UPDATE account_user SET token_version=$2, updated_at=now() WHERE id=$1`, [claims.sub, Number(u.token_version ?? 0) + 1]);
          await rows(`UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [claims.sub]);
        }
      } catch {}
    }
    return response(req, { ok: true }, 200, { "set-cookie": clearedSessionCookie() });
  }
  if (path === "auth/me" && req.method === "GET") {
    const claims = claimsFrom(req);
    if (!claims) throw new HttpError(401, "UNAUTHORIZED");
    const verified = await assertTokenVersion(claims);
    const user = (await rows<any>("SELECT id,email,role,display_name,phone,status,totp_enabled FROM account_user WHERE id=$1 LIMIT 1", [verified.sub]))[0];
    if (!user) throw new HttpError(401, "UNAUTHORIZED");
    return response(req, { id: user.id, email: user.email, role: user.role, name: user.display_name, phone: user.phone, status: user.status, totpEnabled: !!user.totp_enabled });
  }
  if (path === "auth/totp/enroll" && req.method === "POST") {
    const claims = claimsFrom(req);
    if (!claims) throw new HttpError(401, "UNAUTHORIZED");
    const verified = await assertTokenVersion(claims);
    const user = (await rows<any>("SELECT email FROM account_user WHERE id=$1 LIMIT 1", [verified.sub]))[0];
    if (!user) throw new HttpError(401, "UNAUTHORIZED");
    const secret = totpSecretRandom();
    const otpauthUrl = totpOtpauthUrl(secret, user.email);
    await rows("UPDATE account_user SET totp_secret=$2, updated_at=now() WHERE id=$1", [verified.sub, secret]);
    return response(req, { secret, otpauthUrl });
  }
  if (path === "auth/totp/verify" && req.method === "POST") {
    const claims = claimsFrom(req);
    if (!claims) throw new HttpError(401, "UNAUTHORIZED");
    const verified = await assertTokenVersion(claims);
    const user = (await rows<any>("SELECT totp_secret FROM account_user WHERE id=$1 LIMIT 1", [verified.sub]))[0];
    if (!user?.totp_secret) throw new HttpError(400, "TOTP_NOT_ENROLLED");
    if (!totpVerify(user.totp_secret, String(body.code ?? ""))) throw new HttpError(401, "INVALID_TOTP");
    await rows("UPDATE account_user SET totp_enabled=true, totp_enrolled_at=now(), updated_at=now() WHERE id=$1", [verified.sub]);
    return response(req, { ok: true, enabled: true });
  }
  if (path === "auth/totp/disable" && req.method === "POST") {
    const claims = claimsFrom(req);
    if (!claims) throw new HttpError(401, "UNAUTHORIZED");
    const verified = await assertTokenVersion(claims);
    const user = (await rows<any>("SELECT totp_secret, totp_enabled FROM account_user WHERE id=$1 LIMIT 1", [verified.sub]))[0];
    if (!user) throw new HttpError(404, "NOT_FOUND");
    if (user.totp_enabled) {
      if (!body.code) throw new HttpError(400, "TOTP_REQUIRED");
      if (!user.totp_secret || !totpVerify(user.totp_secret, String(body.code))) throw new HttpError(401, "INVALID_TOTP");
    }
    await rows("UPDATE account_user SET totp_secret=NULL, totp_enabled=false, totp_enrolled_at=NULL, updated_at=now() WHERE id=$1", [verified.sub]);
    return response(req, { ok: true, enabled: false });
  }
  throw new HttpError(404, "NOT_FOUND");
}


async function handleSupplier(req: NextRequest, path: string) {
  const method = req.method;
  if (path === "supplier/apply" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.companyName?.trim() || !body.representativeName?.trim() || !body.phone?.trim() || !body.category?.trim()) {
      throw new HttpError(422, "INVALID_INPUT");
    }
    const id = makeId("sapp");
    await rows(
      `INSERT INTO supplier_application (id,company_name,representative_name,phone,category,monthly_capacity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, body.companyName.trim(), body.representativeName.trim(), body.phone.trim(), body.category.trim(), body.monthlyCapacity ?? null],
    );
    return response(req, { id }, 201);
  }
  if (path === "supplier/auth/login" && method === "POST") {
    const body = await jsonBody(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const ip = clientIp(req);
    const user = (await rows<any>("SELECT * FROM account_user WHERE email=$1 AND role='supplier' LIMIT 1", [email]))[0];
    if (!user || !passwordMatches(String(body.password ?? ""), user.salt, user.password_hash)) {
      if (user) {
        const attempts = Number(user.failed_login_attempts ?? 0) + 1;
        let lockedUntil: Date | null = null;
        if (attempts >= 5) lockedUntil = new Date(Date.now() + 15*60*1000);
        try { await rows(`UPDATE account_user SET failed_login_attempts=$2, locked_until=$3, updated_at=now() WHERE id=$1`, [user.id, attempts, lockedUntil]); } catch {}
        try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,false)`, [makeId("lat"), user.id, email, ip]); } catch {}
      } else {
        try { await rows(`INSERT INTO login_attempt (id,email,ip,success) VALUES ($1,$2,$3,false)`, [makeId("lat"), email, ip]); } catch {}
      }
      throw new HttpError(401, "INVALID_CREDENTIALS");
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw new HttpError(423, "ACCOUNT_LOCKED");
    if (user.status !== "active") throw new HttpError(403, "ACCOUNT_SUSPENDED");
    if (user.totp_enabled) {
      if (!body.totpCode) throw new HttpError(401, "TOTP_REQUIRED");
      if (!user.totp_secret || !totpVerify(user.totp_secret, String(body.totpCode))) {
        try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,false)`, [makeId("lat"), user.id, email, ip]); } catch {}
        throw new HttpError(401, "INVALID_TOTP");
      }
    }
    const context = await supplierContext(user.id);
    if (!context) throw new HttpError(403, "SUPPLIER_ACCESS_INACTIVE");
    try { await rows(`UPDATE account_user SET failed_login_attempts=0, locked_until=NULL, last_login_at=now(), updated_at=now() WHERE id=$1`, [user.id]); } catch {}
    try { await rows(`INSERT INTO login_attempt (id,user_id,email,ip,success) VALUES ($1,$2,$3,$4,true)`, [makeId("lat"), user.id, email, ip]); } catch {}
    const token = issueToken(user.id, user.role, Number(user.token_version ?? 0));
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await rows(`INSERT INTO user_session (id,user_id,token_hash,expires_at,ip,user_agent) VALUES ($1,$2,$3,$4,$5,$6)`, [makeId("ses"), user.id, tokenHash, new Date(Date.now() + 14*24*60*60*1000), ip, req.headers.get("user-agent") ?? null]);
    } catch {}
    return response(req, { token, supplier: context }, 200, { "set-cookie": sessionCookie(token) });
  }

  const claims = await requireRole(req, "supplier");
  const context = await supplierContext(claims.sub);
  if (!context) throw new HttpError(403, "SUPPLIER_ACCESS_INACTIVE");
  if (path === "supplier/session" && method === "GET") return response(req, { supplier: context });
  if (path === "supplier/products" && method === "GET") {
    const submissions = await rows<any>(`SELECT * FROM supplier_product_submission WHERE supplier_id=$1 ORDER BY created_at DESC`, [context.supplierId]);
    return response(req, { products: submissions.map((item) => ({ id: item.id, name: item.proposed_name, sku: item.attributes?.sku ?? "", category: item.attributes?.category ?? "", description: item.proposed_description, wholesale_price: item.attributes?.wholesalePrice ?? 0, status: item.status, product_variants: item.variants ?? [] })) });
  }
  if (path === "supplier/products" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.name?.trim() || !body.sku?.trim() || !body.category?.trim()) throw new HttpError(422, "INVALID_INPUT");
    const wholesalePrice = parseMoneyInput(body.wholesalePrice ?? 0, "INVALID_WHOLESALE_PRICE");
    const stock = parseNonNegativeInteger(body.stock ?? 0, "INVALID_STOCK", 1_000_000);
    try {
      const submission = await transaction(async (client) => {
        const sku = body.sku.trim().toUpperCase();
        const submissionId = makeId("sps");
        const slug = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + submissionId.slice(-6);
        // Ensure seller exists for this supplier
        const sellerId = `seller_${context.supplierId}`;
        await client.query(
          `INSERT INTO seller (id,type,supplier_id,display_name,status) VALUES ($1,'SUPPLIER',$2,$3,'active') ON CONFLICT (id) DO NOTHING`,
          [sellerId, context.supplierId, context.displayName || context.supplierId]
        );
        const size = body.size?.trim() || "تک‌سایز";
        const color = body.color?.trim() || "بدون رنگ";
        const result = await client.query<any>(
          `INSERT INTO supplier_product_submission
             (id,supplier_id,seller_id,proposed_name,proposed_slug,proposed_description,attributes,variants,media,status,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review',$10) RETURNING *`,
          [submissionId, context.supplierId, sellerId, body.name.trim(), slug, body.description?.trim() || "",
           JSON.stringify({ sku, category: body.category.trim(), wholesalePrice, proposedStock: stock }),
           JSON.stringify([{ sku: `${sku}-${size}`.toUpperCase(), attributes: { size, color, color_hex: body.colorHex || null } }]),
           JSON.stringify(body.imageUrl ? [{ url: body.imageUrl, type: "image" }] : []), claims.sub],
        );
        return result.rows[0];
      });
      return response(req, { product: { id: submission.id, name: submission.proposed_name, sku: body.sku.trim().toUpperCase(), status: submission.status } }, 201);
    } catch (error: any) {
      if (error?.code === "23505") throw new HttpError(409, "DUPLICATE_SKU");
      throw error;
    }
  }
  if (path === "supplier/orders" && method === "GET") return response(req, { orders: await purchaseOrders(context.supplierId) });
  const orderStatus = path.match(/^supplier\/orders\/([^/]+)\/status$/);
  if (orderStatus && method === "POST") {
    const body = await jsonBody(req);
    const nestAction = mapLegacySupplierStatusToNest(body.status);
    if (!nestAction) {
      throw new HttpError(400, "INVALID_STATUS_TRANSITION");
    }
    const childId = orderStatus[1];
    const forwardPath = `supplier/orders/${childId}/${nestAction}`;
    const forwardBody: any = {};
    if (body.trackingCode) forwardBody.trackingCode = body.trackingCode;
    if (body.reason) forwardBody.reason = body.reason;
    if (body.expectedVersion !== undefined) forwardBody.expectedVersion = body.expectedVersion;
    const result = await forwardToNest(req, "POST", forwardPath, forwardBody);
    if (result.status >= 400) {
      throw new HttpError(result.status, result.data?.error || result.data?.code || "NEST_FORWARD_ERROR", result.data?.message);
    }
    return response(req, result.data, result.status);
  }
  if (path === "supplier/rfqs" && method === "GET") {
    const rfqs = await rows<any>("SELECT * FROM rfq WHERE supplier_id=$1 ORDER BY created_at DESC", [context.supplierId]);
    return response(req, { rfqs });
  }
  const quoteMatch = path.match(/^supplier\/rfqs\/([^/]+)\/quote$/);
  if (quoteMatch && method === "POST") {
    const body = await jsonBody(req);
    if (!body.unitPrice) throw new HttpError(422, "INVALID_INPUT");
    const rfq = (await rows<any>("SELECT * FROM rfq WHERE id=$1 AND supplier_id=$2", [quoteMatch[1], context.supplierId]))[0];
    if (!rfq) throw new HttpError(404, "RFQ_NOT_FOUND");
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO quote (id,rfq_id,supplier_id,unit_price,lead_time_days,notes) VALUES ($1,$2,$3,$4,$5,$6)`,
        [makeId("quo"), rfq.id, context.supplierId, Number(body.unitPrice), Number(body.leadTimeDays ?? 0), body.notes?.trim() || null],
      );
      await client.query("UPDATE rfq SET status='quoted',updated_at=now() WHERE id=$1", [rfq.id]);
    });
    return response(req, { status: "quoted" }, 201);
  }
  if (path === "supplier/tickets" && method === "GET") {
    return response(req, { tickets: await rows("SELECT * FROM support_ticket WHERE supplier_id=$1 ORDER BY created_at DESC", [context.supplierId]) });
  }
  if (path === "supplier/tickets" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.subject?.trim() || !body.message?.trim()) throw new HttpError(422, "INVALID_INPUT");
    const id = makeId("tic");
    await rows(
      `INSERT INTO support_ticket (id,supplier_id,subject,category,message,priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, context.supplierId, body.subject.trim(), body.category?.trim() || "عمومی", body.message.trim(), ["low", "normal", "high"].includes(body.priority) ? body.priority : "normal"],
    );
    return response(req, { id }, 201);
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function handleWholesale(req: NextRequest, path: string) {
  if (path === "wholesale/apply" && req.method === "POST") {
    let claims = claimsFrom(req);
    if (!claims || !["customer", "vip"].includes(claims.role)) throw new HttpError(401, "UNAUTHORIZED");
    claims = await assertTokenVersion(claims);
    const body = await jsonBody(req);
    if (!body.storeName?.trim() || !body.phone?.trim() || !body.city?.trim()) throw new HttpError(422, "INVALID_INPUT");
    if (!body.paymentReference?.trim() || !body.planName?.trim()) throw new HttpError(422, "PAYMENT_REQUIRED");

    /**
     * ⚠️ اصلاح P0 ممیزی (ایراد D2 — «خودتأییدی عضویت VIP»).
     *
     * رفتار قبلی: این endpoint با یک «شمارهٔ پیگیری پرداخت» متنی آزاد، عضویت را
     * بلافاصله `approved` می‌کرد و نقش کاربر را به `vip` ارتقا می‌داد. یعنی هر
     * مشتری می‌توانست بدون هیچ تأییدی به قیمت‌های عمده و کاتالوگ تأمین‌کنندهٔ
     * تأییدشده دسترسی بگیرد.
     *
     * رفتار جدید: درخواست همیشه `pending` ثبت می‌شود؛ تصمیم فقط با
     * `POST admin/accounts/:id/status` (نقش admin) گرفته می‌شود و ارتقای نقش
     * نیز فقط همان‌جا انجام می‌شود.
     */
    const account = await transaction(async (client) => {
      const existing = (
        await client.query<any>(
          "SELECT * FROM wholesale_account WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [claims.sub],
        )
      ).rows[0];

      // اگر عضویت فعال یا در انتظار تأیید است، درخواست دوباره نباید آن را بازنشانی کند.
      if (existing && (existing.status === "approved" || existing.status === "pending")) {
        return existing;
      }

      const status = "pending";
      if (existing) {
        return (
          await client.query<any>(
            `UPDATE wholesale_account
             SET member_name=$2,store_name=$3,phone=$4,city=$5,plan_name=$6,status=$7,
                 activated_at=NULL,expires_at=NULL,updated_at=now()
             WHERE id=$1 RETURNING *`,
            [
              existing.id,
              body.memberName?.trim() || body.storeName.trim(),
              body.storeName.trim(),
              body.phone.trim(),
              body.city.trim(),
              body.planName.trim(),
              status,
            ],
          )
        ).rows[0];
      }

      return (
        await client.query<any>(
          `INSERT INTO wholesale_account (id,user_id,member_name,store_name,phone,city,plan_name,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            makeId("wacc"),
            claims.sub,
            body.memberName?.trim() || body.storeName.trim(),
            body.storeName.trim(),
            body.phone.trim(),
            body.city.trim(),
            body.planName.trim(),
            status,
          ],
        )
      ).rows[0];
    });

    return response(req, 
      {
        status: account.status,
        account,
        // ارجاع متنی پرداخت دیگر مبنای تأیید نیست و فقط برای پیگیری مالی نگه داشته می‌شود.
        paymentReference: body.paymentReference,
        message: "درخواست عضویت ثبت شد و در انتظار بررسی کارشناسان کلبه است.",
      },
      201,
    );
  }
  const claims = claimsFrom(req);
  if (!claims || !["customer", "vip"].includes(claims.role)) throw new HttpError(401, "UNAUTHORIZED");

  // خواندن وضعیت عضویت برای نمایش «در انتظار تأیید» در UI؛ بدون فعال‌سازی دسترسی.
  if (path === "wholesale/account" && req.method === "GET") {
    const latest = (
      await rows<any>(
        "SELECT * FROM wholesale_account WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [claims.sub],
      )
    )[0];
    return response(req, { account: latest ?? null, active: isAccountActive(latest) });
  }

  // از این پس فقط عضویت تأییدشده و معتبر اجازهٔ استفاده از عمده را دارد.
  const account = await activeAccount(claims.sub);
  if (!account) throw new HttpError(403, "VIP_ACCOUNT_INACTIVE");
  if (path === "wholesale/products" && req.method === "GET") return response(req, { products: await catalog("WHERE p.status='published'") });
  if (path === "wholesale/orders" && req.method === "GET") return response(req, { orders: await wholesaleOrders(account.id) });
  if (path === "wholesale/orders" && req.method === "POST") {
    const body = await jsonBody(req);
    if (Array.isArray((body as any).lines)) {
      assertLegacyMutationsEnabled();
      throw new HttpError(422, "LEGACY_ORDER_FORMAT_DEPRECATED", "Use canonical POST /api/v1/wholesale/orders with requests, paymentMode, shippingAddress, billingAddress and Idempotency-Key");
    }
    if (!Array.isArray(body.requests) || body.requests.length === 0) {
      throw new HttpError(422, "INVALID_REQUEST_BATCH");
    }
    const idempotencyKey = readIdempotencyKey(req);
    if (!idempotencyKey) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
    const forwardBody = {
      requests: body.requests,
      paymentMode: body.paymentMode,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
    };
    const result = await forwardToNest(req, "POST", "wholesale/orders", forwardBody);
    if (result.status >= 400) {
      throw new HttpError(result.status, result.data?.error || result.data?.code || "NEST_FORWARD_ERROR", result.data?.message);
    }
    return response(req, result.data, result.status);
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function handleAdmin(req: NextRequest, path: string) {
  const claims = await requireRole(req, "admin");
  const method = req.method;
  if (path === "admin/site-settings" && method === "PUT") {
    const body = await jsonBody(req);
    if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) throw new HttpError(422, "INVALID_SETTINGS");
    const video = embeddedHeroVideo(body.settings);
    const bannerVideo = embeddedBannerVideo(body.settings);
    // اعتبارسنجی سمت سرور پیش از هر ذخیره‌سازی (قاعدهٔ upload validation).
    const heroVideoBytes = video ? validateEmbeddedVideo(video) : 0;
    const bannerVideoBytes = bannerVideo ? validateEmbeddedVideo(bannerVideo) : 0;
    const settings = withoutEmbeddedVideos(body.settings);
    await transaction(async (client) => {
      if (video) {
        await client.query(
          `INSERT INTO site_setting (setting_key,value,updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [HERO_VIDEO_SETTING_KEY, { dataUrl: video }, claims.sub],
        );
      }
      if (bannerVideo) {
        await client.query(
          `INSERT INTO site_setting (setting_key,value,updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [BANNER_VIDEO_SETTING_KEY, { dataUrl: bannerVideo }, claims.sub],
        );
      }
      await client.query(
        `INSERT INTO site_setting (setting_key,value,updated_by) VALUES ('storefront',$1,$2)
         ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [settings, claims.sub],
      );
      // فقط خلاصهٔ تغییرات ثبت می‌شود، نه کل blob تنظیمات (حجم و حساسیت).
      await appendAudit(client, {
        actorId: claims.sub,
        actorRole: "admin",
        action: "site_settings.updated",
        entityType: "site_setting",
        entityId: "storefront",
        before: null,
        after: { keys: Object.keys(settings ?? {}).slice(0, 50) },
        metadata: {
          ip: clientIp(req),
          heroVideoBytes,
          bannerVideoBytes,
        },
      });
    });
    return response(req, { saved: true, updatedAt: new Date().toISOString() });
  }
  if (path === "admin/accounts" && method === "GET") return response(req, { accounts: await rows("SELECT * FROM wholesale_account ORDER BY created_at DESC") });
  const accountStatus = path.match(/^admin\/accounts\/([^/]+)\/status$/);
  if (accountStatus && method === "POST") {
    const body = await jsonBody(req);
    const account = (await rows<any>("SELECT * FROM wholesale_account WHERE id=$1", [accountStatus[1]]))[0];
    if (!account || !body.status) throw new HttpError(account ? 422 : 404, account ? "INVALID_INPUT" : "ACCOUNT_NOT_FOUND");
    if (!["pending", "approved", "rejected", "suspended", "expired"].includes(body.status)) {
      throw new HttpError(422, "INVALID_INPUT");
    }
    // این تنها مسیر قانونی تأیید عضویت VIP است (اصلاح ایراد D2 — خودتأییدی).
    await transaction(async (client) => {
      await client.query(
        `UPDATE wholesale_account SET status=$2,activated_at=CASE WHEN $2='approved' THEN now() ELSE activated_at END,
         expires_at=CASE WHEN $2='approved' THEN $3 ELSE expires_at END,updated_at=now() WHERE id=$1`,
        [account.id, body.status, body.expiresAt ?? null],
      );
      if (body.status === "approved") {
        await client.query("UPDATE account_user SET role='vip',updated_at=now() WHERE id=$1", [account.user_id]);
      } else if (body.status === "rejected" || body.status === "suspended") {
        // پس‌گرفتن دسترسی عمده: اگر کاربر عضویت دیگری ندارد، نقش به customer برمی‌گردد.
        await client.query(
          `UPDATE account_user SET role='customer',updated_at=now()
           WHERE id=$1 AND NOT EXISTS (
             SELECT 1 FROM wholesale_account
             WHERE user_id=$1 AND id<>$2 AND status='approved' AND (expires_at IS NULL OR expires_at > now())
           )`,
          [account.user_id, account.id],
        );
      }
      await appendAudit(client, {
        actorId: claims.sub,
        actorRole: "admin",
        action: "vip_account.status_changed",
        entityType: "wholesale_account",
        entityId: account.id,
        before: { status: account.status },
        after: { status: body.status, expires_at: body.expiresAt ?? account.expires_at },
        metadata: { ip: clientIp(req), note: body.note ?? null },
      });
    });
    return response(req, { status: body.status });
  }
  if (path === "admin/supplier-applications" && method === "GET") return response(req, { applications: await rows("SELECT * FROM supplier_application ORDER BY created_at DESC") });
  const applicationStatus = path.match(/^admin\/supplier-applications\/([^/]+)$/);
  if (applicationStatus && method === "POST") {
    const body = await jsonBody(req);
    const application = (await rows<any>("SELECT * FROM supplier_application WHERE id=$1", [applicationStatus[1]]))[0];
    if (!application || !body.status) throw new HttpError(application ? 422 : 404, application ? "INVALID_INPUT" : "APPLICATION_NOT_FOUND");
    if (body.status !== "approved") {
      await transaction(async (client) => {
        await client.query("UPDATE supplier_application SET status=$2,updated_at=now() WHERE id=$1", [application.id, body.status]);
        await appendAudit(client, {
          actorId: claims.sub,
          actorRole: "admin",
          action: "supplier_application.reviewed",
          entityType: "supplier_application",
          entityId: application.id,
          before: { status: application.status },
          after: { status: body.status },
          metadata: { ip: clientIp(req) },
        });
      });
      return response(req, { status: body.status });
    }
    const supplierId = makeId("sup");
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO supplier (id,legal_name,display_name,phone,category,monthly_capacity,status) VALUES ($1,$2,$2,$3,$4,$5,'approved')`,
        [supplierId, application.company_name, application.phone, application.category, application.monthly_capacity],
      );
      await client.query("UPDATE supplier_application SET status='approved',updated_at=now() WHERE id=$1", [application.id]);
      let createdUserId: string | null = null;
      if (body.loginEmail && String(body.loginPassword ?? "").length >= 8) {
        const credentials = passwordRecord(String(body.loginPassword));
        const userId = makeId("usr");
        await client.query(
          `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone) VALUES ($1,$2,$3,$4,'supplier',$5,$6)`,
          [userId, String(body.loginEmail).trim().toLowerCase(), credentials.passwordHash, credentials.salt, application.company_name, application.phone],
        );
        await client.query("INSERT INTO supplier_member (id,supplier_id,user_id,title) VALUES ($1,$2,$3,$4)", [makeId("smem"), supplierId, userId, "مدیر تأمین"]);
        createdUserId = userId;
      }
      await appendAudit(client, {
        actorId: claims.sub,
        actorRole: "admin",
        action: "supplier_application.approved",
        entityType: "supplier_application",
        entityId: application.id,
        before: { status: application.status },
        // هیچ رمز عبوری در حسابرسی ثبت نمی‌شود؛ فقط اینکه حساب ساخته شد یا نه.
        after: { status: "approved", supplier_id: supplierId, login_created: createdUserId !== null },
        metadata: { ip: clientIp(req) },
      });
    });
    return response(req, { status: "approved", supplier_id: supplierId });
  }
  if (path === "admin/audit-logs" && method === "GET") {
    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    const values: unknown[] = [];
    const filters: string[] = [];
    if (entityType) {
      values.push(entityType);
      filters.push(`entity_type=$${values.length}`);
    }
    if (entityId) {
      values.push(entityId);
      filters.push(`entity_id=$${values.length}`);
    }
    values.push(limit);
    const logs = await rows<any>(
      `SELECT * FROM audit_log ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return response(req, { logs });
  }
  if (path === "admin/suppliers" && method === "GET") return response(req, { suppliers: await rows("SELECT * FROM supplier ORDER BY created_at DESC") });
  if (path === "admin/catalog" && method === "GET") {
    const products = await catalog();
    const suppliers = await rows<any>("SELECT id,display_name FROM supplier");
    const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.display_name]));
    const sellerMap = await rows<any>("SELECT id,supplier_id FROM seller");
    const sellerToSupplier = new Map(sellerMap.map((s: any) => [s.id, s.supplier_id]));
    return response(req, { products: products.map((product: any) => ({
      ...product, supplier_name: names.get(product.supplier_id ?? sellerToSupplier.get(product.seller_id) ?? "") ?? "—",
      stock: product.product_variants.reduce((sum: number, variant: any) => sum + Number(variant.inventory?.on_hand ?? 0), 0),
    })) });
  }
  const catalogStatus = path.match(/^admin\/catalog\/([^/]+)\/status$/);
  if (catalogStatus && method === "POST") {
    const body = await jsonBody(req);
    if (!body.status) throw new HttpError(422, "INVALID_INPUT");
    // قاعدهٔ «Moderation»: محصول تأمین‌کننده فقط با تصمیم صریح کلبه منتشر می‌شود.
    if (!["draft", "submitted", "approved", "rejected", "archived"].includes(body.status)) {
      throw new HttpError(422, "INVALID_INPUT");
    }
    await transaction(async (client) => {
      const before = (
        await client.query<any>("SELECT status FROM product WHERE id=$1 FOR UPDATE", [catalogStatus[1]])
      ).rows[0];
      if (!before) throw new HttpError(404, "PRODUCT_NOT_FOUND");
      await client.query("UPDATE product SET status=$2,updated_at=now() WHERE id=$1", [
        catalogStatus[1],
        body.status,
      ]);
      await appendAudit(client, {
        actorId: claims.sub,
        actorRole: "admin",
        action: "catalog.moderation_status_changed",
        entityType: "product",
        entityId: catalogStatus[1],
        before: { status: before.status },
        after: { status: body.status },
        metadata: { ip: clientIp(req), note: body.note ?? null },
      });
    });
    return response(req, { status: body.status });
  }
  if (path === "admin/catalog/bulk-price" && method === "POST") {
    const body = await jsonBody(req);
    if (!Array.isArray(body.ids) || !body.ids.length || !Number.isFinite(Number(body.value))) throw new HttpError(422, "INVALID_INPUT");
    if (body.ids.length > 500) throw new HttpError(422, "TOO_MANY_ROWS");
    if (!["amount", "percent"].includes(body.mode ?? "amount")) throw new HttpError(422, "INVALID_INPUT");
    const mode = body.mode ?? "amount";

    /**
     * قاعدهٔ «Do not store monetary values as float» (ایراد D11 ممیزی).
     *
     * نسخهٔ قبلی از `wholesale_price*(1+$3/100.0)` استفاده می‌کرد؛ یعنی محاسبهٔ
     * اعشاری روی پول. حالا درصد با حساب صحیح (basis points) و به‌صورت
     * `price * bp / 10000` محاسبه می‌شود و نتیجه با ROUND به نزدیک‌ترین ریال می‌رود.
     * تقسیم صحیح پستگرس روی bigint، عدد صحیح برمی‌گرداند (بدون کسر اعشاری).
     */
    const result = await transaction(async (client) => {
      const value = BigInt(Math.trunc(Number(body.value)));
      // مقدار «درصد» است؛ برای پرهیز از ریاضی اعشاری به صدم‌درصد (basis point) تبدیل می‌شود:
      //   قیمت جدید = ROUND( قیمت × (10000 + درصد×100) / 10000 )
      const basisPoints = value * 100n;
      const updated = await client.query<any>(
        mode === "percent"
          ? `UPDATE seller_offer
             SET wholesale_price=GREATEST(0,
                   ((wholesale_price * (10000 + $2)) + 5000) / 10000),
                 updated_at=now()
             WHERE product_id=ANY($1::text[]) RETURNING id, wholesale_price`
          : `UPDATE seller_offer
             SET wholesale_price=GREATEST(0, wholesale_price + $2), updated_at=now()
             WHERE product_id=ANY($1::text[]) RETURNING id, wholesale_price`,
        [body.ids, (mode === "percent" ? basisPoints : value).toString()],
      );
      await appendAudit(client, {
        actorId: claims.sub,
        actorRole: "admin",
        action: "catalog.bulk_price_updated",
        entityType: "seller_offer",
        entityId: null,
        before: null,
        after: { mode, value: value.toString(), ids: body.ids },
        metadata: { ip: clientIp(req), updated: updated.rowCount ?? 0, prices: updated.rows },
      });
      return updated.rowCount ?? 0;
    });
    return response(req, { updated: result });
  }
  if (path === "admin/purchase-orders" && method === "GET") return response(req, { orders: await purchaseOrders() });
  const poStatus = path.match(/^admin\/purchase-orders\/([^/]+)\/status$/);
  if (poStatus && method === "POST") {
    const body = await jsonBody(req);
    await transaction(async (client) => {
      const before = (
        await client.query<any>("SELECT status FROM purchase_order WHERE id=$1", [poStatus[1]])
      ).rows[0];
      await updatePurchaseOrder(client, poStatus[1], body.status, body.trackingCode);
      await appendAudit(client, {
        actorId: claims.sub,
        actorRole: "admin",
        action: "purchase_order.status_changed",
        entityType: "purchase_order",
        entityId: poStatus[1],
        before: before ? { status: before.status } : null,
        after: { status: body.status, tracking_code: body.trackingCode ?? null },
        metadata: { ip: clientIp(req) },
      });
    });
    return response(req, { status: body.status });
  }
  if (path === "admin/orders" && method === "GET") {
    const [orders, accounts, suppliers, pos] = await Promise.all([wholesaleOrders(), rows<any>("SELECT * FROM wholesale_account"), rows<any>("SELECT * FROM supplier"), purchaseOrders()]);
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return response(req, { orders: orders.map((order) => ({
      ...order, store_name: accountMap.get(order.account_id)?.store_name ?? "—",
      purchase_orders: pos.filter((po) => po.wholesale_order_id === order.id).map((po) => ({
        id: po.id, order_code: po.order_code, status: po.status,
        supplier_name: supplierMap.get(po.supplier_id)?.display_name ?? "—", tracking_code: po.tracking_code,
      })),
    })) });
  }
  const approveOrder = path.match(/^admin\/orders\/([^/]+)\/approve$/);
  if (approveOrder && method === "POST") {
    assertLegacyMutationsEnabled();
    throw new HttpError(410, "LEGACY_APPROVAL_REMOVED", "Order approval that creates children is removed — children are created atomically at order creation via POST /api/v1/wholesale/orders (Phase 4.3)");
  }
  const cancelOrder = path.match(/^admin\/orders\/([^/]+)\/cancel$/);
  if (cancelOrder && method === "POST") {
    const body = await jsonBody(req);
    if (!body.reason) throw new HttpError(400, "CANCELLATION_REASON_REQUIRED");
    const orderId = cancelOrder[1];
    const forwardBody = { reason: body.reason, expectedVersion: body.expectedVersion };
    const result = await forwardToNest(req, "POST", `admin/wholesale/orders/${orderId}/cancel`, forwardBody);
    if (result.status >= 400) {
      const result2 = await forwardToNest(req, "POST", `wholesale/orders/${orderId}/cancel`, forwardBody);
      if (result2.status >= 400) {
        throw new HttpError(result.status, result.data?.error || result.data?.code || "NEST_FORWARD_ERROR", result.data?.message);
      }
      return response(req, result2.data, result2.status);
    }
    return response(req, result.data, result.status);
  }
  if (path === "admin/rfqs" && method === "GET") return response(req, { rfqs: await rows("SELECT * FROM rfq ORDER BY created_at DESC") });
  if (path === "admin/rfqs" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.supplierId || !body.title?.trim()) throw new HttpError(422, "INVALID_INPUT");
    const id = makeId("rfq");
    const referenceCode = `RFQ-${new Date().getFullYear()}-${randomUUID().slice(0, 5).toUpperCase()}`;
    await rows(
      `INSERT INTO rfq (id,supplier_id,reference_code,title,customer_name,quantity,requested_delivery_date,specifications)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [id, body.supplierId, referenceCode, body.title.trim(), body.customerName?.trim() || "کلبه وینتیج", Number(body.quantity ?? 0), body.requestedDeliveryDate ?? null, body.specifications ?? {}],
    );
    return response(req, { id, reference_code: referenceCode }, 201);
  }
  if (path === "admin/tickets" && method === "GET") return response(req, { tickets: await rows("SELECT * FROM support_ticket ORDER BY created_at DESC") });
  const ticketStatus = path.match(/^admin\/tickets\/([^/]+)$/);
  if (ticketStatus && method === "POST") {
    const body = await jsonBody(req);
    if (!body.status) throw new HttpError(422, "INVALID_INPUT");
    await rows(
      `UPDATE support_ticket SET status=$2,admin_reply=COALESCE($3,admin_reply),updated_at=now() WHERE id=$1 RETURNING id`,
      [ticketStatus[1], body.status, body.adminReply?.trim() || null],
    );
    return response(req, { status: body.status });
  }
  if (path === "admin/logs" && method === "GET") {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit")) || 50));
    const values: unknown[] = [];
    const filters: string[] = [];
    for (const [key, column] of [["level", "level"], ["source", "source"], ["status", "status"]] as const) {
      const value = url.searchParams.get(key);
      if (value && value !== "all") { values.push(value); filters.push(`${column}=$${values.length}`); }
    }
    const query = url.searchParams.get("q")?.trim();
    if (query) { values.push(`%${query}%`); filters.push(`(message ILIKE $${values.length} OR event_type ILIKE $${values.length} OR path ILIKE $${values.length})`); }
    const range = url.searchParams.get("range") ?? "24h";
    if (range !== "all") {
      const interval = range === "30d" ? "30 days" : range === "7d" ? "7 days" : "24 hours";
      filters.push(`last_seen_at >= now() - interval '${interval}'`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = Number((await rows<any>(`SELECT count(*) AS count FROM system_log ${where}`, values))[0]?.count ?? 0);
    values.push(limit, (page - 1) * limit);
    const logs = await rows<any>(`SELECT * FROM system_log ${where} ORDER BY last_seen_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const summary = (await rows<any>(
      `SELECT
       coalesce(sum(occurrence_count) FILTER (WHERE status='open' AND level IN ('error','critical')),0) AS open_errors,
       coalesce(sum(occurrence_count) FILTER (WHERE status='open' AND level='critical'),0) AS critical_open,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND level IN ('error','critical')),0) AS errors_24h,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND source='frontend'),0) AS frontend_24h,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND level='warning'),0) AS warnings_24h,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND event_type='api.slow'),0) AS slow_24h
       FROM system_log`,
    ))[0];
    return response(req, {
      logs: logs.map(logShape),
      pagination: { page, limit, total, pageCount: Math.max(1, Math.ceil(total / limit)), capped: false },
      summary: { openErrors: Number(summary.open_errors), criticalOpen: Number(summary.critical_open), errors24h: Number(summary.errors_24h), frontend24h: Number(summary.frontend_24h), warnings24h: Number(summary.warnings_24h), slow24h: Number(summary.slow_24h) },
    });
  }
  const logStatus = path.match(/^admin\/logs\/([^/]+)$/);
  if (logStatus && method === "POST") {
    const body = await jsonBody(req);
    const [log] = await rows<any>(
      `UPDATE system_log SET status=$2,resolved_at=CASE WHEN $2='open' THEN NULL ELSE now() END,
       resolved_by=CASE WHEN $2='open' THEN NULL ELSE $3 END,resolution_note=$4,updated_at=now() WHERE id=$1 RETURNING *`,
      [logStatus[1], body.status, claims.sub, body.note?.trim() || null],
    );
    if (!log) throw new HttpError(404, "LOG_NOT_FOUND");
    return response(req, { log: logShape(log) });
  }
  throw new HttpError(404, "NOT_FOUND");
}

/**
 * مسیرهای پرو مجازی که **هزینه‌زا** هستند (بارگذاری فایل و ساخت task).
 * بقیهٔ مسیرهای `try-on/*` (خواندن وضعیت/دانلود) سهمیه مصرف نمی‌کنند.
 */
const TRY_ON_BILLABLE_PATHS = new Set(["try-on/files", "try-on/tasks"]);

/**
 * نگهبان پرو مجازی — اصلاح D20 (فاز ۱.۵).
 *
 * ── چه چیزی خراب بود ───────────────────────────────────────────────────────
 * `try-on/*` **پیش از** زنجیرهٔ احراز هویت و **پیش از** `await database()`
 * پردازش می‌شد. یعنی یک کاربر ناشناس (یا ربات) می‌توانست با کلید پولی
 * Perfect Corp کلبه تصویر آپلود کند و task بسازد؛ هم هزینهٔ مستقیم و هم
 * quota ارائه‌دهنده را مصرف می‌کرد و هیچ ردی از مصرف‌کننده باقی نمی‌ماند.
 *
 * ── اصلاح ──────────────────────────────────────────────────────────────────
 *   ۱) نشست الزامی است (نقش customer یا vip) — پیش از رسیدن به ارائه‌دهنده.
 *   ۲) سهمیهٔ ساعتی و روزانه روی عملیات هزینه‌زا (`try-on-guard.ts`).
 *   ۳) کلید سهمیه همان شناسهٔ امضاشدهٔ کاربر است، نه IP (قابل جعل با XFF).
 *
 * خواندن وضعیت task و دانلود نتیجه همچنان نشست لازم دارد اما سهمیه مصرف نمی‌کند
 * تا polling سمت مرورگر (`TryOn.tsx`) سهمیهٔ کاربر را نسوزاند.
 */
async function handleTryOn(req: NextRequest, path: string) {
  const claims = await requireAnyRole(req, ["customer", "vip"]);
  if (TRY_ON_BILLABLE_PATHS.has(path)) {
    const quota = path === "try-on/tasks"
      ? consumeTryOnTaskQuota(claims.sub)
      : consumeTryOnUploadQuota(claims.sub);
    if (!quota.allowed) {
      throw new HttpError(429, "TRY_ON_QUOTA_EXCEEDED");
    }
  }
  const result = await handlePerfectCorpRequest(req, path);
  return result instanceof Response ? result : response(result);
}

/**
 * نگهبان لاگ کلاینت — اصلاح D21 (فاز ۱.۵).
 *
 * ── چه چیزی خراب بود ───────────────────────────────────────────────────────
 * `POST logs/client` بدون هیچ احراز هویتی، هر درخواست را به یک ردیف
 * `system_log` تبدیل می‌کرد (Probe 6 ممیزی: `202` بدون توکن). یعنی یک
 * primitive نوشتنِ آزاد با پیام/نشانیِ کنترل‌شده توسط مهاجم: پر شدن دیسک و
 * مسموم‌سازی داشبورد خطاها (پنهان‌کردن رخدادهای واقعی بین نویز).
 *
 * ── اصلاح ──────────────────────────────────────────────────────────────────
 *   ۱) نشست الزامی است؛ لاگ ناشناس پذیرفته نمی‌شود.
 *   ۲) سهمیهٔ ساعتی برای هر کاربر (۶۰ رخداد) تا حتی کاربر واردشده هم نتواند
 *      دیتابیس را با نویز پر کند.
 *   ۳) سقف اندازهٔ بدنه و بریدن فیلدها (پیش از این هم بود، حفظ شد).
 *
 * هزینهٔ پذیرفته‌شده: خطاهای کارِ کاربران **ناشناس** دیگر ثبت نمی‌شوند
 * (`clientLogger.ts` وقتی نشستی نیست چیزی نمی‌فرستد). بازگرداندن تلمتری ناشناس
 * با یک توکن امضاشدهٔ سایت، کار فاز ۶ است (یادداشت در گزارش فاز ۱.۵).
 */
const CLIENT_LOG_LIMIT_PER_HOUR = 60;

/**
 * نتیجهٔ سنجش سلامت: «قابل اطمینان» یا «نامطمئن با دلیل عمومی».
 * هیچ متن خطای دیتابیس از این تابع بیرون نمی‌رود.
 */
async function healthProbe(): Promise<
  { ok: true } | { ok: false; reason: "query-failed" | "migrations-required"; detail?: string }
> {
  try {
    return await transaction(async (client) => {
      await client.query("SELECT 1");
      await assertDatabaseReady(client);
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof DatabaseNotMigratedError) {
      return { ok: false, reason: "migrations-required", detail: `${error.code}: ${error.details?.join("; ")}` };
    }
    return { ok: false, reason: "query-failed", detail: "database: query failed" };
  }
}

async function handleClientLog(req: NextRequest) {
  const claims = await requireAnyRole(req, ["customer", "vip", "admin", "supplier"]);
  const quota = consumeRateLimit(`logs:client:${claims.sub}`, {
    limit: CLIENT_LOG_LIMIT_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!quota.allowed) throw new HttpError(429, "LOG_QUOTA_EXCEEDED");

  const body = await jsonBody(req);
  const message = String(body.message ?? "خطای بدون پیام").slice(0, 2000);
  const fingerprint = createHash("sha256")
    .update([body.type, body.name, body.url, message].join("|"))
    .digest("hex")
    .slice(0, 32);
  await rows(
    `INSERT INTO system_log (id,level,source,event_type,message,error_name,stack,fingerprint,http_method,path,http_status,environment,release,metadata,actor_id,actor_role,first_seen_at,last_seen_at)
     VALUES ($1,$2,'frontend',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())
     ON CONFLICT (fingerprint) WHERE status='open' DO UPDATE SET last_seen_at=now(),occurrence_count=system_log.occurrence_count+1,updated_at=now() RETURNING id`,
    [
      makeId("log"),
      body.status && body.status < 500 ? "warning" : "error",
      body.type ?? "frontend.error",
      message,
      body.name ? String(body.name).slice(0, 160) : null,
      body.stack ? String(body.stack).slice(0, 12_000) : null,
      fingerprint,
      body.method ? String(body.method).slice(0, 16) : null,
      body.url ? String(body.url).slice(0, 512) : null,
      Number.isInteger(body.status) ? body.status : null,
      process.env.NODE_ENV ?? "development",
      body.release ? String(body.release).slice(0, 64) : null,
      JSON.stringify({ line: body.line, column: body.column, componentStack: body.componentStack }),
      claims.sub,
      claims.role,
    ],
  );
  return response(req, { accepted: true }, 202);
}

async function handleRequest(req: NextRequest, pathParts: string[]) {
  const path = pathParts.join("/");
  // فاز ۲: بررسی Origin برای درخواست‌های تغییردهنده (D35)
  try { checkOrigin(req); } catch (e) { throw e; }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(req.headers.get("origin")) });
  }
  if (path.startsWith("try-on/")) {
    return handleTryOn(req, path);
  }
  const canonicalRead = await cutOverLegacyBusinessRead(req, path);
  if (canonicalRead) return canonicalRead;
  const canonicalWrite = await cutOverLegacyBusinessWrite(req, path);
  if (canonicalWrite) return canonicalWrite;
  if (path === "health") {
    /**
     * سلامت = «دیتابیس مهاجرت‌شده و سازگار است؟». این مسیر باید **بسته** شکست
     * بخورد (fail closed) و هیچ جزئیات دیتابیسی به بیرون ندهد:
     *   • ۲۰۰ → اتصال برقرار و `assertDatabaseReady` قبول شد
     *   • ۵۰۳ → دیتابیس در دسترس نیست یا مهاجرت/سازگاری اسکیما تأیید نشد
     * متن خطا فقط در لاگ سرور می‌ماند و پاسخ همیشه پیام عمومی دارد.
     */
    const probe = await healthProbe();
    if (!probe.ok) {
      console.error(`[kolbe] health probe failed: ${probe.reason} ${probe.detail ?? ""}`.trim());
      return NextResponse.json(
        { ok: false, service: "kolbe-api", database: "unavailable", reason: probe.reason },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: true, service: "kolbe-api", database: "postgresql", schema: "verified" },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (path === "logs/client" && req.method === "POST") {
    return handleClientLog(req);
  }
  await database();
  if ((path === "site/hero-video" || path === "site/banner-video") && req.method === "GET") {
    const isBanner = path === "site/banner-video";
    const settingKey = isBanner ? BANNER_VIDEO_SETTING_KEY : HERO_VIDEO_SETTING_KEY;
    const stored = (await rows<any>("SELECT value FROM site_setting WHERE setting_key=$1 LIMIT 1", [settingKey]))[0];
    let dataUrl = stored?.value?.dataUrl as string | undefined;
    if (!dataUrl) {
      const legacy = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='storefront' LIMIT 1"))[0];
      dataUrl = (isBanner ? embeddedBannerVideo(legacy?.value) : embeddedHeroVideo(legacy?.value)) ?? undefined;
    }
    const video = dataUrl ? parseVideoDataUrl(dataUrl) : null;
    if (!video) throw new HttpError(404, "HERO_VIDEO_NOT_FOUND");

    const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    const commonHeaders = {
      ...corsHeadersFor(req.headers.get("origin")),
      "content-type": video.mime,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=3600",
    };
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = Math.min(range[2] ? Number(range[2]) : video.bytes.length - 1, video.bytes.length - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
        return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${video.bytes.length}` } });
      }
      const chunkLength = end - start + 1;
      return new Response(videoStream(video.bytes, start, end), {
        status: 206,
        headers: {
          ...commonHeaders,
          "content-length": String(chunkLength),
          "content-range": `bytes ${start}-${end}/${video.bytes.length}`,
        },
      });
    }
    return new Response(videoStream(video.bytes), {
      headers: { ...commonHeaders, "content-length": String(video.bytes.length) },
    });
  }
  if (path === "site/settings" && req.method === "GET") {
    const setting = (await rows<any>("SELECT value,updated_at FROM site_setting WHERE setting_key='storefront' LIMIT 1"))[0];
    const video = embeddedHeroVideo(setting?.value);
    const bannerVideo = embeddedBannerVideo(setting?.value);
    const settings = withoutEmbeddedVideos(setting?.value ?? null);
    if (video) {
      // مهاجرت یک‌باره داده قدیمی: ویدیو را از JSON عمومی و حجیم تنظیمات جدا می‌کند.
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO site_setting (setting_key,value) VALUES ($1,$2)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
          [HERO_VIDEO_SETTING_KEY, { dataUrl: video }],
        );
        await client.query("UPDATE site_setting SET value=$1,updated_at=now() WHERE setting_key='storefront'", [settings]);
      });
    }
    if (bannerVideo) {
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO site_setting (setting_key,value) VALUES ($1,$2)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
          [BANNER_VIDEO_SETTING_KEY, { dataUrl: bannerVideo }],
        );
        await client.query("UPDATE site_setting SET value=$1,updated_at=now() WHERE setting_key='storefront'", [settings]);
      });
    }
    return response(req, { settings, updatedAt: setting?.updated_at ?? null });
  }
  if (path.startsWith("auth/")) return handleAuth(req, path);
  if (path === "me" && req.method === "GET") {
    const claims = await requireRole(req, "customer");
    const user = (await rows<any>("SELECT id,email,display_name,phone FROM account_user WHERE id=$1", [claims.sub]))[0];
    if (!user) throw new HttpError(401, "UNAUTHORIZED");
    return response(req, { id: user.id, name: user.display_name ?? user.email.split("@")[0], phone: user.phone ?? "—", email: user.email });
  }
  /**
   * Phase 5.8 — Retail compat proxy (NOT a writer, NOT a pricer).
   *
   * Canonical checkout lives in Nest `RetailOrdersService`. This handler only
   * translates the frozen legacy body to the Nest DTO, forwards cookie +
   * idempotency key + internal token via `forwardToNest`, and translates the
   * Nest response/error back to the frozen legacy shape. No INSERT/UPDATE of
   * `retail_order`/`retail_order_item` happens here.
   */
  if (path === "retail/orders" && req.method === "POST") {
    const body = await jsonBody(req);
    const submittedLines = Array.isArray((body as any)?.lines) ? (body as any).lines : [];
    const idempotencyKey = resolveRetailIdempotencyKey(req.headers.get("idempotency-key"));
    const nestBody = translateRetailOrderToNest(body, idempotencyKey);
    const extra: Record<string, string> = {};
    const internalToken = process.env.KOLBE_INTERNAL_API_TOKEN?.trim();
    if (internalToken) extra["x-kolbe-internal-token"] = internalToken;
    let result: { status: number; data: any };
    try {
      result = await forwardToNest(req, "POST", "retail/orders", nestBody, extra);
    } catch {
      throw new HttpError(503, "RETAIL_UPSTREAM_UNAVAILABLE", "سرویس سفارش در دسترس نیست؛ سفارش ثبت نشد");
    }
    if (result.status < 200 || result.status >= 300) {
      throw translateRetailNestError(result.status, result.data);
    }
    const translated = translateRetailOrderFromNest(result.data, submittedLines);
    // Phase 5.9-A: guest capability echo. The translator already strips the
    // secret from the frozen legacy body; it travels ONLY as this header
    // (fresh guest creations only — Nest never emits it otherwise).
    const guestHeaders: Record<string, string> = {};
    if (typeof result.data?.guestCapability === "string" && result.data.guestCapability) {
      guestHeaders["x-retail-order-token"] = result.data.guestCapability;
    }
    return response(req, translated.body, translated.status, guestHeaders);
  }
  if (path.startsWith("supplier/")) return handleSupplier(req, path);
  if (path.startsWith("wholesale/")) return handleWholesale(req, path);
  if (path.startsWith("admin/")) return handleAdmin(req, path);
  throw new HttpError(404, "NOT_FOUND");
}

/**
 * طبقه‌بندی خطا برای پاسخ عمومی کلاینت.
 *
 * ── اصلاح D26 (فاز ۱.۵) ─────────────────────────────────────────────────────
 * پیش از این، کد عمومی مستقیماً از `error.code` خوانده می‌شد. خطاهای `pg` هم
 * فیلد `code` دارند و آن **SQLSTATE** است؛ نتیجهٔ عملی این بود که یک قیمت
 * اعشاری در ثبت محصول تأمین‌کننده، به‌جای خطای دامنه‌ای،
 * `{"error":"22P02","message":"خطای داخلی سرور"}` برمی‌گرداند — یعنی کد داخلی
 * پستگرس بخشی از قرارداد عمومی API شده بود. کدهایی مثل `23505`/`23503` هم
 * می‌توانند ساختار اسکیما را افشا کنند.
 *
 * قاعدهٔ جدید: فقط خطاهای **شناخته‌شدهٔ دامنه** کد خودشان را دارند.
 * هر خطای دیگر (خطای درایور، خطای برنامه‌نویسی، استثنای پیش‌بینی‌نشده)
 * `INTERNAL_ERROR` با پیام عمومی می‌شود و جزئیات فقط در لاگ سرور می‌ماند.
 *
 * `export` شده تا تست رگرسیون D26 بتواند مستقیماً خطاهای شبیه‌سازِ درایور
 * (مثل `{code:"22P02"}`) را به آن بدهد و ثابت کند کد SQLSTATE به بیرون درز نمی‌کند.
 */
export function publicError(error: unknown): { status: number; code: string; message: string } {
  if (isHttpError(error)) {
    return {
      status: error.status,
      code: error.code,
      message: error.status >= 500 ? "خطای داخلی سرور" : error.message,
    };
  }
  // کدهای ارائه‌دهندهٔ پرو مجازی عمداً منتقل می‌شوند: `TryOn.tsx` آن‌ها را به
  // پیام فارسی نگاشت می‌کند (`PERFECT_CORP_NOT_CONFIGURED`, `error_pose`, …) و
  // خودشان راز داخلی نیستند؛ فقط ۵xx پیام عمومی می‌گیرد.
  if (isPerfectCorpError(error)) {
    return {
      status: error.status,
      code: error.message,
      message: error.status >= 500 ? "خطای داخلی سرور" : error.message,
    };
  }
  /**
   * دیتابیس مهاجرت‌نشده یا ناقص → ۵۰۳ با پیام عمومی.
   *
   * چرا ۵۰۳ و نه ۵۰۰؟ چون این یک نقص کد نیست، «سرویس آماده نیست» است؛
   * orchestrator/healthcheck باید بتواند آن را از یک باگ تشخیص دهد. جزئیات
   * (نام جدول/ستون/مهاجرت) هرگز به کلاینت نمی‌رود؛ فقط در لاگ سرور ثبت می‌شود
   * (`initialize()` در `database.ts` آن‌ها را چاپ می‌کند).
   */
  if (error instanceof DatabaseNotMigratedError) {
    return { status: 503, code: "SERVICE_UNAVAILABLE", message: "سرویس موقتاً در دسترس نیست" };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "خطای داخلی سرور" };
}

export async function handleKolbeRequest(req: NextRequest, pathParts: string[]) {
  const cors = corsHeadersFor(req.headers.get("origin"));
  try {
    return await handleRequest(req, pathParts);
  } catch (error: any) {
    const { status, code, message } = publicError(error);
    if (status >= 500) {
      // قانون حاکم: هیچ جزئیات داخلی (stack/پیام دیتابیس) به کلاینت درز نمی‌کند؛
      // فقط در لاگ سرور ثبت می‌شود. کد واقعی در لاگ می‌ماند تا اشکال‌زدایی ممکن باشد.
      console.error(`[kolbe-api] ${req.method} /${pathParts.join("/")} → ${status} (${code})`, error);
    }
    return Response.json({ error: code, message }, { status, headers: cors });
  }
}

export function corsHeaders(origin: string | null = null) {
  return { ...corsHeadersFor(origin) };
}
