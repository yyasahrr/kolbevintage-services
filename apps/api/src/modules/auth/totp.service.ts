/**
 * سرویس TOTP — فاز ۲.
 *
 * پیاده‌سازی حداقلی TOTP (RFC 6238) با HMAC-SHA1، گام ۳۰ ثانیه، ۶ رقم.
 * - تولید راز base32
 * - ساخت otpauth:// URL برای QR
 * - تأیید کد با پنجرهٔ ±1
 *
 * چرا بدون وابستگی خارجی؟ برای پرهیز از افزودن `otplib`/`speakeasy` در این فاز؛
 * پیاده‌سازی فعلی برای enrolment و آزمون کافی است و در فاز ۶ با کتابخانهٔ
 * حسابرسی‌شده و رمزنگاری secret جایگزین می‌شود.
 */

import { randomBytes, createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  // بدون padding (RFC 3548 اجازه می‌دهد)
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function intToBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  // counter is 64-bit big-endian
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter, 4);
  return buf;
}

export class TotpService {
  /** تولید راز ۲۰ بایتی (۱۶۰ بیت) — توصیهٔ RFC 4226 */
  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /** ساخت URL برای QR — سازگار با Google Authenticator/Authy */
  otpauthUrl(secret: string, email: string, issuer = "Kolbe Vintage"): string {
    const label = encodeURIComponent(`${issuer}:${email}`);
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: "SHA1",
      digits: "6",
      period: "30",
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  /** تولید کد برای یک گام زمانی مشخص (برای آزمون) */
  generateCode(secret: string, timeStep?: number): string {
    const step = timeStep ?? Math.floor(Date.now() / 1000 / 30);
    const key = base32Decode(secret);
    const counter = intToBuffer(step);
    const hmac = createHmac("sha1", key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return (code % 1_000_000).toString().padStart(6, "0");
  }

  /** تأیید کد با پنجرهٔ ±1 (۹۰ ثانیه تحمل) */
  verify(secret: string, token: string, window = 1): boolean {
    if (!/^\d{6}$/.test(token)) return false;
    const current = Math.floor(Date.now() / 1000 / 30);
    for (let i = -window; i <= window; i++) {
      if (this.generateCode(secret, current + i) === token) return true;
    }
    return false;
  }
}
