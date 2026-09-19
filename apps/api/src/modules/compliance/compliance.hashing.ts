import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ComplianceDomainError } from "./compliance.errors";

/** Deterministic JSON (sorted keys, bigint → string, Date → ISO) used for every evidence hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Date) return val.toISOString();
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(val as Record<string, unknown>).sort()) sorted[key] = (val as Record<string, unknown>)[key];
      return sorted;
    }
    return val;
  });
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Normalizes Persian/Arabic digits and whitespace so the same contact always hashes identically. */
export function normalizeContact(raw: string): string {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of raw.trim().toLowerCase()) {
    const p = persian.indexOf(ch);
    const a = arabic.indexOf(ch);
    out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
  }
  return out.replace(/[\s\-()]/g, "");
}

/**
 * Keyed hashing for subject identifiers and bank destinations.
 *
 * Key resolution: `KOLBE_COMPLIANCE_HASH_KEY` (dedicated) → `KOLBE_SESSION_SECRET`
 * (development fallback). In production the dedicated key is mandatory — a
 * missing key fails closed instead of silently hashing with a guessable value.
 */
@Injectable()
export class ComplianceKeyring {
  private readonly key: string;

  constructor() {
    const dedicated = process.env.KOLBE_COMPLIANCE_HASH_KEY?.trim();
    const fallback = process.env.KOLBE_SESSION_SECRET?.trim();
    if (dedicated && dedicated.length >= 16) {
      this.key = dedicated;
    } else if (process.env.NODE_ENV === "production") {
      throw new ComplianceDomainError("COMPLIANCE_HASH_KEY_MISSING", "KOLBE_COMPLIANCE_HASH_KEY (حداقل ۱۶ کاراکتر) در محیط production الزامی است");
    } else {
      this.key = fallback && fallback.length > 0 ? `${fallback}:compliance` : "kolbe-compliance-dev-key";
    }
  }

  hmac(purpose: string, value: string): string {
    return createHmac("sha256", this.key).update(`${purpose}\n${value}`).digest("hex");
  }

  /** Stable subject identity: users hash by id, guests by normalized contact. */
  subjectHash(subject: { userId?: string | null; contact?: string | null }): string {
    if (subject.userId) return this.hmac("subject:user", subject.userId);
    if (subject.contact) return this.hmac("subject:guest", normalizeContact(subject.contact));
    throw new ComplianceDomainError("VALIDATION_ERROR", "هویت پذیرنده (کاربر یا مخاطب مهمان) مشخص نیست", 400);
  }

  bankDestinationHash(kind: string, normalized: string): string {
    return this.hmac(`bank:${kind}`, normalized);
  }

  signToken(payload: string): string {
    return createHmac("sha256", this.key).update(`token\n${payload}`).digest("base64url");
  }

  verifyToken(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.signToken(payload));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

/** Sanitized request metadata → one hash. Raw IP / UA are never persisted. */
export function requestMetadataHash(meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } | undefined | null): string | null {
  if (!meta) return null;
  const ip = meta.ip ? String(meta.ip).trim() : "";
  const ua = meta.userAgent ? String(meta.userAgent).trim().slice(0, 256) : "";
  const rid = meta.requestId ? String(meta.requestId).trim() : "";
  if (!ip && !ua && !rid) return null;
  return sha256Hex(`${ip}\n${ua}\n${rid}`);
}

/* ───────────── Bank destination normalization (format checks only, not verification) ───────────── */

function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

/** IBAN mod-97 (ISO 13616) format check. Iranian IBANs are "IR" + 24 digits. */
export function isValidIban(normalized: string): boolean {
  if (!/^IR\d{24}$/.test(normalized)) return false;
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(numeric) === 1;
}

/** Luhn check for 16-digit card numbers. */
export function isValidCard(normalized: string): boolean {
  if (!/^\d{16}$/.test(normalized)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = Number(normalized[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function normalizeBankDestination(kind: "iban" | "card" | "account", raw: string): { normalized: string; masked: string } {
  const compact = normalizeContact(raw).toUpperCase();
  if (kind === "iban") {
    if (!isValidIban(compact)) throw new ComplianceDomainError("BANK_DESTINATION_INVALID", "شمارهٔ شبا معتبر نیست", 400);
    return { normalized: compact, masked: `${compact.slice(0, 4)}${"*".repeat(compact.length - 8)}${compact.slice(-4)}` };
  }
  if (kind === "card") {
    if (!isValidCard(compact)) throw new ComplianceDomainError("BANK_DESTINATION_INVALID", "شمارهٔ کارت معتبر نیست", 400);
    return { normalized: compact, masked: `${compact.slice(0, 4)}********${compact.slice(-4)}` };
  }
  if (!/^\d{6,26}$/.test(compact)) throw new ComplianceDomainError("BANK_DESTINATION_INVALID", "شمارهٔ حساب معتبر نیست", 400);
  return { normalized: compact, masked: `${"*".repeat(Math.max(0, compact.length - 4))}${compact.slice(-4)}` };
}
