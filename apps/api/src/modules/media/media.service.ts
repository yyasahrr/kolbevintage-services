/**
 * ذخیره‌سازی رسانه — seam کوچکِ سمتِ سرور برای بارگذاریِ فایل.
 *
 * چرا این ماژول لازم است؟ پیش از این **هیچ** مسیرِ بارگذاریِ واقعی در مخزن وجود
 * نداشت (تنها پیکربندیِ `S3_*` در `.env.example`). در نتیجه تنها راهِ ثبتِ
 * تصویر، «چسباندنِ URL» بود که هم تجربهٔ کاربریِ جعلی است و هم تأمین‌کننده را
 * مجبور می‌کند جای دیگری فایل را میزبانی کند.
 *
 * قاعدهٔ امنیتی: کلیدِ دسترسی/رمزِ ذخیره‌سازی **هرگز** به مرورگر نمی‌رسد.
 * مرورگر فقط فایل را آپلود می‌کند و یک URL می‌گیرد.
 *
 * قاعدهٔ صداقت: اگر پروایدرِ واقعی (S3) پیکربندی نشده باشد، یک پروایدرِ محلیِ
 * **واقعی** فایل را روی دیسک می‌نویسد و همان را سرو می‌کند. هرگز URLِ «موفقِ»
 * جعلی تولید نمی‌شود و هرگز دادهٔ تجاریِ ساختگی در وضعیتِ محصول نمی‌نشیند.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

/** توکنِ تزریقِ پروایدرِ ذخیره‌سازی (Symbol تا با توکنِ کلاس اشتباه نشود). */
export const MEDIA_STORAGE_TOKEN = "KOLBE_MEDIA_STORAGE";

export type MediaKind = "image" | "video";

export type StoredMedia = {
  /** نشانیِ قابلِ استفاده در گرافِ محصول (مسیرِ نسبیِ API). */
  url: string;
  /** کلیدِ ذخیره‌سازی؛ برای ارجاع/حذف. */
  key: string;
  size: number;
  contentType: string;
  kind: MediaKind;
  /** نامِ پروایدر — تا UI بداند URL از کجا آمده است. */
  provider: string;
};

export type MediaStorageProvider = {
  readonly name: string;
  put(input: { buffer: Buffer; contentType: string; kind: MediaKind; originalName: string }): Promise<StoredMedia>;
  /** خواندنِ فایل برای سرو‌کردن (پروایدرِ محلی). */
  read?(key: string): Promise<{ stream: Readable; contentType: string; size: number } | null>;
};

/** نگاشتِ MIME → پسوندِ امن. هر چیزی بیرون از این فهرست رد می‌شود. */
const ALLOWED_CONTENT_TYPES: Record<string, { kind: MediaKind; extension: string }> = {
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/png": { kind: "image", extension: "png" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/gif": { kind: "image", extension: "gif" },
  "video/mp4": { kind: "video", extension: "mp4" },
};

export function describeContentType(contentType: string): { kind: MediaKind; extension: string } | null {
  return ALLOWED_CONTENT_TYPES[contentType.toLowerCase().split(";")[0]!.trim()] ?? null;
}

/** حدِ اندازهٔ فایل (بایت). پیش‌فرض ۱۲ مگابایت. */
export const DEFAULT_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * پروایدرِ محلی: فایل را زیرِ `directory` می‌نویسد و از مسیرِ API سرو می‌کند.
 *
 * نامِ فایل از hashِ محتوا + بایتِ تصادفی ساخته می‌شود (نه از نامِ کاربر)، پس
 * نامِ اصلی نمی‌تواند مسیر را دستکاری کند. کلید همیشه با الگوی امن ساخته و
 * هنگامِ خواندن دوباره اعتبارسنجی می‌شود تا path-traversal ممکن نباشد.
 */
export class LocalMediaStorage implements MediaStorageProvider {
  readonly name = "local";

  constructor(private readonly directory: string, private readonly publicBasePath: string) {}

  async put(input: { buffer: Buffer; contentType: string; kind: MediaKind; originalName: string }): Promise<StoredMedia> {
    const described = describeContentType(input.contentType);
    if (!described) throw new Error(`UNSUPPORTED_MEDIA_TYPE: ${input.contentType}`);

    const now = new Date();
    const partition = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const digest = createHash("sha256").update(input.buffer).digest("hex").slice(0, 16);
    const key = `${partition}/${digest}-${randomBytes(6).toString("hex")}.${described.extension}`;

    const absolute = path.join(this.directory, key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.buffer);

    return {
      url: `${this.publicBasePath}/${key}`,
      key,
      size: input.buffer.byteLength,
      contentType: input.contentType,
      kind: input.kind,
      provider: this.name,
    };
  }

  async read(key: string): Promise<{ stream: Readable; contentType: string; size: number } | null> {
    // کلید فقط می‌تواند از اجزای امن ساخته شود؛ هر چیز دیگر = تلاش برای traversal.
    if (!/^[0-9]{4}\/[0-9]{2}\/[a-f0-9]{16}-[a-f0-9]{12}\.[a-z0-9]{3,4}$/.test(key)) return null;
    const absolute = path.join(this.directory, key);
    const resolved = path.resolve(absolute);
    if (!resolved.startsWith(path.resolve(this.directory) + path.sep)) return null;

    const { stat } = await import("node:fs/promises");
    try {
      const info = await stat(resolved);
      if (!info.isFile()) return null;
      return {
        stream: createReadStream(resolved),
        contentType: contentTypeForExtension(path.extname(resolved).slice(1)),
        size: info.size,
      };
    } catch {
      return null;
    }
  }
}

/** حدسِ نوعِ محتوا از پسوند (فقط برای سرو‌کردنِ فایلِ محلی). */
export function contentTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

/**
 * سرویسِ رسانه.
 *
 * پروایدر از پیکربندی ساخته می‌شود. اگر `S3_*` پیکربندی شده باشد ولی هیچ
 * پروایدرِ S3 ای سیم‌کشی نشده باشد، **صریحاً خطا می‌دهد** — نه اینکه بی‌صدا به
 * یک URLِ جعلی تنزل کند.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(@Inject(MEDIA_STORAGE_TOKEN) private readonly provider: MediaStorageProvider) {
    this.logger.log(`media storage provider = ${this.provider.name}`);
  }

  get providerName(): string {
    return this.provider.name;
  }

  async upload(input: { buffer: Buffer; contentType: string; originalName: string }): Promise<StoredMedia> {
    if (!input.buffer || input.buffer.byteLength === 0) {
      throw new Error("EMPTY_UPLOAD");
    }
    const described = describeContentType(input.contentType);
    if (!described) {
      throw new Error("UNSUPPORTED_MEDIA_TYPE");
    }
    return this.provider.put({
      buffer: input.buffer,
      contentType: input.contentType,
      kind: described.kind,
      originalName: input.originalName,
    });
  }

  read(key: string) {
    if (!this.provider.read) return Promise.resolve(null);
    return this.provider.read(key);
  }
}
