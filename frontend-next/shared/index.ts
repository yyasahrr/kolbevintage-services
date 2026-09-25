/**
 * مرز مشترک فرانت‌اند (فاز ۶.۱).
 *
 * هر پورتال (خرده، VIP، تأمین‌کننده، ادمین، CMS) قرار است فقط از این نقطه
 * وارد شود و دیگر هیچ کلاینتِ HTTP/نشست/خطای جداگانه‌ای نسازد:
 *
 *   Canonical Nest API
 *        ↓
 *   shared/http  → خطاها، نتایج، پایهٔ نشانی، لغو
 *   shared/session → هویت از سرور، هرگز از localStorage
 *   shared/ui   → مدل وضعیت (EMPTY ≠ ERROR)
 *   shared/pagination → NONE/OFFSET/KEYSET/CURSOR
 *   shared/money → رشتهٔ ده‌دهی، بدون float
 *   shared/permissions → دسترسی از سرور، نه از نقش
 *   shared/design → نشانه‌ها و تم (بدون تغییر ظاهر)
 */

export * as http from "./http";
export * as session from "./session";
export * as ui from "./ui";
export * as pagination from "./pagination";
export * as money from "./money";
export * as permissions from "./permissions";
export * as design from "./design";
