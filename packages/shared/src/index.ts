/**
 * @kolbe/shared — قراردادهای مشترک دامنهٔ کلبه.
 *
 * این پکیج **هیچ وابستگی به فریم‌ورک یا دیتابیس ندارد** و می‌تواند هم توسط
 * `apps/api` (NestJS) و هم توسط لایهٔ گذار (route handler فعلی Next.js) استفاده شود.
 *
 * قواعد پوشش‌داده‌شده در این پکیج:
 *  - A10 «Do not store monetary values as float» → `money.ts`
 *  - A14 «State-machine statuses must be validated server-side» → `order-status.ts`
 *  - A15 «All external callbacks/webhooks must be idempotent» → `idempotency.ts`
 *  - قرارداد خطای عمومی → `errors.ts`
 */

export * from "./money";
export * from "./order-status";
export * from "./errors";
export * from "./idempotency";
