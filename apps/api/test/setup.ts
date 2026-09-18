/**
 * پیش‌نیازهای اجرای تست‌ها.
 *
 * `reflect-metadata` باید **قبل از ارزیابی هر کلاسی که دکوراتور دارد** import شود؛
 * در غیر این صورت Nest متادیتای `design:paramtypes` را نمی‌بیند و تزریق وابستگی
 * بر اساس نوع (مثل `Reflector`) مقدار undefined می‌گیرد. در `main.ts` این import
 * خط اول است؛ اینجا هم باید همین‌طور باشد.
 */
import "reflect-metadata";
