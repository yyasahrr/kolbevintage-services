/**
 * پیکربندی OpenAPI.
 *
 * چرا تابع جداگانه؟ چون قرارداد API باید در **تست** هم تولید شود. اگر پیکربندی
 * فقط داخل `main.ts` بماند، آزمون نمی‌تواند ثابت کند سرویس واقعاً یک سند
 * OpenAPI معتبر سرو می‌کند (و مستندات بی‌سروصدا از کد جدا می‌شود).
 */

import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export const API_PREFIX = "api/v1";

export function setupOpenApi(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Kolbe Vintage API")
      .setDescription(
        "API یکپارچه پلتفرم کلبه وینتیج (مونولیت ماژولار NestJS). " +
          "قرارداد خطا: { error, message, requestId } — فیلد error پایدار است و کلاینت روی آن تصمیم می‌گیرد.",
      )
      .setVersion("1.0.0")
      .addBearerAuth()
      .build(),
    // مسیرها با پیشوند کامل `/api/v1` منتشر می‌شوند تا کلاینت تولیدشده
    // دقیقاً همان URLهایی را صدا بزند که در تولید سرو می‌شوند.
    { ignoreGlobalPrefix: false },
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document, {
    jsonDocumentUrl: `${API_PREFIX}/openapi.json`,
  });
}
