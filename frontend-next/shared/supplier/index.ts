/**
 * مرزِ دامنهٔ تأمین‌کننده (فاز ۶.۲).
 *
 * ترکیبِ درستِ لایه‌ها:
 *
 *   @shared/http        → حمل‌ونقل، خطا، لغو (یک پیاده‌سازی)
 *   @shared/session     → هویت از سرور
 *   @shared/permissions → capability از سرور
 *   @shared/money       → پولِ ده‌دهی
 *   @shared/ui          → مدل وضعیت
 *   @shared/supplier    → فقط نگاشتِ مسیر و تایپ‌های دامنه
 *
 * پورتال تأمین‌کننده نباید هیچ کلاینت HTTP دیگری بسازد.
 */

import { createApiClient, createCanonicalClient } from "../http";
import { createSupplierApi, type SupplierApi } from "./client";
import { createSupplierSessionClient, type SupplierSessionClient } from "./session";

export * from "./contracts";
export * from "./client";
export * from "./session";
export * from "./present";
export * from "./normalize";

export type SupplierBoundary = {
  client: ReturnType<typeof createApiClient>;
  api: SupplierApi;
  session: SupplierSessionClient;
};

/** ساختِ یکپارچهٔ مرزِ تأمین‌کننده برای استفاده در پورتال و در تست‌ها. */
export function createSupplierBoundary(client = createCanonicalClient()): SupplierBoundary {
  const api = createSupplierApi(client);
  return { client, api, session: createSupplierSessionClient(client, api) };
}
