import { Module } from "@nestjs/common";
import path from "node:path";
import { LocalMediaStorage, MEDIA_STORAGE_TOKEN, MediaService, type MediaStorageProvider } from "./media.service";
import { MediaController } from "./media.controller";

/**
 * انتخابِ پروایدر از پیکربندی.
 *
 * اگر `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` ست شده باشند، یعنی استقرار
 * انتظارِ ذخیره‌سازیِ شیئی دارد؛ چون هیچ پروایدرِ S3 ای در این مخزن سیم‌کشی
 * نشده، **صریحاً شکست می‌خوریم** تا بی‌صدا فایل‌ها روی دیسکِ محلی نروند و بعد
 * در تولید گم شوند.
 */
function createProvider(): MediaStorageProvider {
  const accessKey = (process.env.S3_ACCESS_KEY ?? "").trim();
  const secretKey = (process.env.S3_SECRET_KEY ?? "").trim();
  const bucket = (process.env.S3_BUCKET ?? "").trim();
  if (accessKey && secretKey && bucket) {
    throw new Error(
      "S3 credentials are configured but no S3 media provider is wired in this build. " +
        "Unset S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET to use the local provider, or add an S3 provider.",
    );
  }
  const directory =
    (process.env.KOLBE_MEDIA_DIR ?? "").trim() || path.resolve(process.cwd(), ".media-storage");
  return new LocalMediaStorage(directory, "/api/v1/media/files");
}

@Module({
  controllers: [MediaController],
  providers: [{ provide: MEDIA_STORAGE_TOKEN, useFactory: createProvider }, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
