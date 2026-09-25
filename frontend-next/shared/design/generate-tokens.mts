/**
 * اسکریپتِ تولیدِ `tokens.css` (فاز ۶.۱).
 *
 * اجرا: `npm run tokens:build --workspace kolbe-next`
 *
 * چرا خروجی در مخزن است؟ چون بیلدِ Next.js نباید به اجرای کدِ TypeScript وابسته
 * باشد. این اسکریپت فقط هنگام تغییرِ نشانه‌ها اجرا می‌شود و تستِ
 * `test/phase-6-1-design-tokens.test.ts` هرگونه انحرافِ فایلِ کامیت‌شده را
 * با خطا مواجه می‌کند.
 *
 * اجرا با قابلیتِ type-stripping خودِ Node (بدون وابستگی جدید) انجام می‌شود،
 * برای همین importها پسوندِ `.ts` دارند.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateThemeCss } from "./css.ts";
import { DEFAULT_THEME } from "./tokens.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "tokens.css");

const css = generateThemeCss(DEFAULT_THEME);
mkdirSync(here, { recursive: true });
writeFileSync(target, css, "utf8");
console.log(`✓ نشانه‌های طراحی نوشته شد: ${target} (${css.split("\n").length} خط)`);
