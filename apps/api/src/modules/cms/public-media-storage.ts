import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError, ErrorCodes } from "@kolbe/shared";

export type PublicMediaPut = {
  objectKey: string;
  bytes: Buffer;
  mimeType: string;
};

export type PublicMediaObject = {
  objectKey: string;
  publicUrl: string;
};

/**
 * CMS public-media port. Compliance storage is intentionally not used here.
 * A future S3 provider can implement this interface without changing CMS rows.
 */
export interface PublicMediaStorage {
  readonly provider: "LOCAL_PUBLIC";
  put(input: PublicMediaPut): Promise<PublicMediaObject>;
  read(objectKey: string): Promise<Buffer>;
  remove(objectKey: string): Promise<void>;
}

@Injectable()
export class LocalPublicMediaStorage implements PublicMediaStorage {
  readonly provider = "LOCAL_PUBLIC" as const;
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor() {
    this.root = resolve(process.env.CMS_PUBLIC_MEDIA_DIR ?? "var/cms-public-media");
    this.publicBaseUrl = process.env.CMS_PUBLIC_MEDIA_BASE_URL ?? "/api/v1/cms/public/media";
  }

  async put(input: PublicMediaPut): Promise<PublicMediaObject> {
    const safeKey = input.objectKey.replace(/^\/+/, "");
    if (safeKey.includes("..") || safeKey.includes("\\")) throw new DomainError(422, ErrorCodes.INVALID_INPUT, "Unsafe media object key");
    const target = resolve(this.root, safeKey);
    if (!target.startsWith(`${this.root}/`) && target !== this.root) throw new DomainError(422, ErrorCodes.INVALID_INPUT, "Unsafe media object key");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.bytes, { flag: "wx" });
    const assetId = safeKey.replace(/^cms\//, "").replace(/\.[A-Za-z0-9]{1,8}$/u, "");
    return { objectKey: safeKey, publicUrl: `${this.publicBaseUrl}/${encodeURIComponent(assetId)}/file` };
  }

  async read(objectKey: string): Promise<Buffer> {
    return readFile(this.safePath(objectKey));
  }

  async remove(objectKey: string): Promise<void> {
    await unlink(this.safePath(objectKey));
  }

  private safePath(objectKey: string): string {
    const safeKey = objectKey.replace(/^\/+/, "");
    if (safeKey.includes("..") || safeKey.includes("\\")) throw new DomainError(422, ErrorCodes.INVALID_INPUT, "Unsafe media object key");
    const target = resolve(this.root, safeKey);
    if (!target.startsWith(`${this.root}/`)) throw new DomainError(422, ErrorCodes.INVALID_INPUT, "Unsafe media object key");
    return target;
  }
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function detectMediaSignature(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  // WebM/Matroska EBML header.
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  return null;
}

export function makeObjectKey(assetId: string, filename: string): string {
  const extension = filename.toLowerCase().match(/\.[a-z0-9]{1,8}$/)?.[0] ?? "";
  return `cms/${assetId}${extension}`;
}
