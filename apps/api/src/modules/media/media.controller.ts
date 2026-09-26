import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { Public, Roles } from "../../common/guards/session.guard";
import { DEFAULT_MAX_UPLOAD_BYTES, MediaService, describeContentType } from "./media.service";

/**
 * شکلِ فایلِ multer.
 *
 * `@types/multer` در این مخزن نصب نیست، پس به‌جای افزودنِ وابستگیِ تازه، همان
 * سه فیلدی را که واقعاً استفاده می‌کنیم تایپ می‌کنیم. `FileInterceptor` با
 * `memoryStorage` پیش‌فرض، بافر را در حافظه می‌دهد.
 */
type UploadedMediaFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

/**
 * مسیرِ بارگذاریِ رسانه.
 *
 * - `POST /media/upload`: تأمین‌کننده یا ادمین یک فایل می‌فرستد و `{ url }`
 *   می‌گیرد؛ همان `url` در گرافِ مرحله‌بندی‌شدهٔ محصول قرار می‌گیرد.
 * - `GET /media/files/:key`: سرو‌کردنِ فایلِ پروایدرِ محلی.
 *
 * هیچ کلید/رمزی در پاسخ نیست. اعتبارسنجیِ نوع و اندازه سمتِ سرور است تا
 * مرورگر نتواند هر چیزی را با هر MIME ای بارگذاری کند.
 */
@Controller("media")
export class MediaController {
  /**
   * تزریقِ صریحِ `@Inject`.
   *
   * قراردادِ این مخزن: ترنسفورمِ vitest (esbuild) متادیتای دکوریتور تولید
   * نمی‌کند، پس `design:paramtypes` وجود ندارد و تزریقِ نوعی کار نمی‌کند. همهٔ
   * کنترلرها/سرویس‌ها همین‌طور تزریقِ صریح دارند.
   */
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post("upload")
  @HttpCode(201)
  @Roles("supplier", "admin")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: DEFAULT_MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(@UploadedFile() file: UploadedMediaFile | undefined) {
    if (!file) throw new BadRequestException({ error: "FILE_REQUIRED", message: "هیچ فایلی ارسال نشد" });
    if (!describeContentType(file.mimetype)) {
      throw new BadRequestException({
        error: "UNSUPPORTED_MEDIA_TYPE",
        message: "فقط تصویر (jpeg/png/webp/gif) یا ویدیوی mp4 مجاز است",
      });
    }
    try {
      const stored = await this.media.upload({
        buffer: file.buffer,
        contentType: file.mimetype,
        originalName: file.originalname,
      });
      return { url: stored.url, key: stored.key, size: stored.size, kind: stored.kind, provider: stored.provider };
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (message.startsWith("EMPTY_UPLOAD")) {
        throw new BadRequestException({ error: "EMPTY_UPLOAD", message: "فایل خالی است" });
      }
      throw error;
    }
  }

  /**
   * عمومی: نشانیِ رسانه باید بدونِ نشست قابلِ نمایش باشد.
   *
   * کلید همیشه سه‌بخشی است (`yyyy/mm/name.ext`)، پس به‌جای wildcard از سه
   * پارامترِ صریح استفاده می‌کنیم. در Express 5 الگوی `files/*` دیگر مقدار را در
   * `params[0]` نمی‌گذارد و ابهامِ بی‌مورد می‌سازد.
   */
  @Public()
  @Get("files/:year/:month/:file")
  async serve(
    @Param("year") year: string,
    @Param("month") month: string,
    @Param("file") file: string,
    @Res() res: Response,
  ) {
    const key = `${year}/${month}/${file}`;
    const found = await this.media.read(key);
    if (!found) {
      res.status(404).json({ error: "MEDIA_NOT_FOUND", message: "رسانه یافت نشد" });
      return;
    }
    res.setHeader("Content-Type", found.contentType);
    res.setHeader("Content-Length", String(found.size));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    found.stream.pipe(res);
  }
}
