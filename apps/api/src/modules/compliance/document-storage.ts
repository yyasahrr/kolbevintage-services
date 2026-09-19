import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { ComplianceKeyring, sha256Hex } from "./compliance.hashing";
import { ComplianceDomainError } from "./compliance.errors";

/**
 * Phase 4.7.5 — private compliance document storage.
 *
 * Rules:
 *  - Objects are never public. The API returns only metadata + short-lived
 *    signed access tokens; the object key itself is never exposed.
 *  - Only allow-listed MIME types, validated by magic bytes (declared type must
 *    match content), and a hard size cap.
 *  - The repo has no object-storage abstraction yet; this is the minimal port.
 *    `local_private` writes to a private directory (0700). An `s3_private`
 *    adapter is a documented production requirement (see launch checklist) —
 *    it is NOT implemented here and no credentials are invented.
 */
export const COMPLIANCE_ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
export type ComplianceMime = (typeof COMPLIANCE_ALLOWED_MIME)[number];

export function complianceMaxDocumentBytes(): number {
  const raw = Number(process.env.KOLBE_COMPLIANCE_MAX_DOCUMENT_BYTES || 5 * 1024 * 1024);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 1024 * 1024;
}

const MAGIC: Record<ComplianceMime, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

export function validateDocumentUpload(input: { mimeType: unknown; contentBase64: unknown }): { mimeType: ComplianceMime; bytes: Buffer; checksum: string } {
  if (typeof input.mimeType !== "string" || !(COMPLIANCE_ALLOWED_MIME as readonly string[]).includes(input.mimeType)) {
    throw new ComplianceDomainError("DOCUMENT_TYPE_NOT_ALLOWED", `فقط ${COMPLIANCE_ALLOWED_MIME.join("، ")} مجاز است`);
  }
  if (typeof input.contentBase64 !== "string" || input.contentBase64.length === 0) {
    throw new ComplianceDomainError("VALIDATION_ERROR", "محتوای سند (base64) الزامی است", 400);
  }
  const max = complianceMaxDocumentBytes();
  // base64 expands 4/3 — reject before decoding when clearly oversized.
  if (input.contentBase64.length > Math.ceil((max * 4) / 3) + 4) {
    throw new ComplianceDomainError("DOCUMENT_TOO_LARGE", `حداکثر اندازهٔ سند ${max} بایت است`);
  }
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.length === 0) throw new ComplianceDomainError("VALIDATION_ERROR", "محتوای سند خالی یا نامعتبر است", 400);
  if (bytes.length > max) throw new ComplianceDomainError("DOCUMENT_TOO_LARGE", `حداکثر اندازهٔ سند ${max} بایت است`);
  const mimeType = input.mimeType as ComplianceMime;
  if (!MAGIC[mimeType](bytes)) {
    throw new ComplianceDomainError("DOCUMENT_CONTENT_MISMATCH", "محتوای فایل با نوع اعلام‌شده مطابقت ندارد", 400);
  }
  return { mimeType, bytes, checksum: sha256Hex(bytes) };
}

export function sanitizeFilename(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = path.basename(raw).replace(/[^\w.\-\u0600-\u06FF ]+/g, "_").trim();
  return base.length === 0 ? null : base.slice(0, 120);
}

export interface PrivateDocumentStorage {
  readonly provider: "local_private" | "s3_private";
  put(objectKey: string, bytes: Buffer): Promise<void>;
  read(objectKey: string): Promise<Buffer>;
}

const OBJECT_KEY = /^[a-z0-9][a-z0-9/_\-.]{3,200}$/;

@Injectable()
export class LocalPrivateDocumentStorage implements PrivateDocumentStorage {
  readonly provider = "local_private" as const;
  private readonly root: string;

  constructor() {
    this.root = process.env.KOLBE_PRIVATE_STORAGE_DIR?.trim() || path.join(os.tmpdir(), "kolbe-private-compliance");
  }

  private resolve(objectKey: string): string {
    if (!OBJECT_KEY.test(objectKey) || objectKey.includes("..")) {
      throw new ComplianceDomainError("COMPLIANCE_STORAGE_UNAVAILABLE", "کلید شیء نامعتبر است");
    }
    return path.join(this.root, objectKey);
  }

  async put(objectKey: string, bytes: Buffer): Promise<void> {
    const target = this.resolve(objectKey);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, bytes, { mode: 0o600, flag: "wx" });
  }

  async read(objectKey: string): Promise<Buffer> {
    const target = this.resolve(objectKey);
    try {
      return await fs.readFile(target);
    } catch {
      throw new ComplianceDomainError("COMPLIANCE_STORAGE_UNAVAILABLE", "شیء در ذخیره‌سازی خصوصی یافت نشد");
    }
  }
}

export type SignedAccessPayload = { kind: "supplier_document" | "product_document"; documentId: string; actorId: string; exp: number };

/** Short-lived, HMAC-signed access tokens (default 5 min, max 15 min). */
@Injectable()
export class DocumentAccessSigner {
  constructor(@Inject(ComplianceKeyring) private readonly keyring: ComplianceKeyring) {}

  static ttlSeconds(): number {
    const raw = Number(process.env.KOLBE_COMPLIANCE_DOCUMENT_URL_TTL_SECONDS || 300);
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 900) : 300;
  }

  issue(payload: Omit<SignedAccessPayload, "exp">, nowMs: number): { token: string; expiresAt: Date } {
    const exp = Math.floor(nowMs / 1000) + DocumentAccessSigner.ttlSeconds();
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
    return { token: `${body}.${this.keyring.signToken(body)}`, expiresAt: new Date(exp * 1000) };
  }

  verify(token: string, nowMs: number): SignedAccessPayload {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature || !this.keyring.verifyToken(body, signature)) {
      throw new ComplianceDomainError("DOCUMENT_URL_INVALID", "لینک دسترسی معتبر نیست");
    }
    let payload: SignedAccessPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedAccessPayload;
    } catch {
      throw new ComplianceDomainError("DOCUMENT_URL_INVALID", "لینک دسترسی معتبر نیست");
    }
    if (!payload?.documentId || !payload?.kind || typeof payload.exp !== "number") {
      throw new ComplianceDomainError("DOCUMENT_URL_INVALID", "لینک دسترسی معتبر نیست");
    }
    if (payload.exp * 1000 <= nowMs) throw new ComplianceDomainError("DOCUMENT_URL_EXPIRED", "لینک دسترسی منقضی شده است");
    return payload;
  }
}
