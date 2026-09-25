/**
 * تولیدکنندهٔ CSS از نشانه‌های طراحی (فاز ۶.۱) — تابعِ خالص.
 *
 * خروجیِ این فایل `shared/design/tokens.css` است که در مخزن نگه داشته می‌شود تا
 * بیلدِ Next.js به هیچ ابزارِ اضافه‌ای وابسته نباشد. تستِ «عدمِ انحراف»
 * (drift test) تضمین می‌کند فایلِ کامیت‌شده دقیقاً خروجیِ همین تابع است.
 *
 * ساختارِ خروجی عمداً طوری است که ویرایشگر بصریِ فاز ۶.۴ بتواند همان مدلِ داده را
 * در زمان اجرا به CSS تبدیل کند:
 *   :root (روشن) → حالتِ تاریک → لغوهای breakpoint
 */

import {
  BREAKPOINTS,
  BREAKPOINT_ORDER,
  CSS_VAR_PREFIX,
  flattenTokenSet,
  mergeTokenSets,
  THEME_MODES,
  type ThemeConfig,
  type ThemeMode,
} from "./tokens.ts";

function declarations(flat: Record<string, string>, indent: string): string {
  const lines = Object.entries(flat).map(([name, value]) => `${indent}${name}: ${value};`);
  return lines.join("\n");
}

export function modeSelectors(mode: ThemeMode): string {
  return mode === "dark"
    ? `[data-theme="dark"], [data-kolbe-mode="dark"]`
    : `:root, [data-kolbe-mode="light"]`;
}

function block(selector: string, body: string): string {
  return `${selector} {\n${body}\n}`;
}

function modeBlock(mode: ThemeMode, flat: Record<string, string>): string {
  const body = [
    declarations(flat, "  "),
    `  ${CSS_VAR_PREFIX}mode: ${mode};`,
    `  color-scheme: ${mode};`,
  ].join("\n");
  return block(modeSelectors(mode), body);
}

/**
 * تولیدِ CSS کامل برای یک پیکربندیِ تم.
 *
 * خروجی قطعی (deterministic) است: ترتیبِ نشانه‌ها و selectorها ثابت است، پس
 * مقایسهٔ رشته‌ای در تست معتبر است.
 */
export function generateThemeCss(config: ThemeConfig): string {
  const header = [
    "/* تولیدشده توسط shared/design/generate-tokens.ts — دستی ویرایش نشود. */",
    `/* تم: ${config.id} · منبع یگانه: shared/design/tokens.ts */`,
    "/* فاز ۶.۱: این لایه فقط نشانه اضافه می‌کند و هیچ قانونِ موجودی را تغییر نمی‌دهد. */",
  ].join("\n");

  const parts: string[] = [header];
  for (const mode of THEME_MODES) {
    parts.push(modeBlock(mode, flattenTokenSet(config.modes[mode])));
  }

  const responsive = config.responsive;
  if (responsive) {
    for (const breakpoint of BREAKPOINT_ORDER) {
      const overrides = responsive[breakpoint];
      if (!overrides) continue;
      const mediaBody: string[] = [];
      for (const mode of THEME_MODES) {
        const override = overrides[mode];
        if (!override) continue;
        const merged = flattenTokenSet(mergeTokenSets(config.modes[mode], override));
        mediaBody.push(modeBlock(mode, merged));
      }
      if (mediaBody.length === 0) continue;
      parts.push(block(`@media (min-width: ${BREAKPOINTS[breakpoint]}px)`, mediaBody.join("\n\n")));
    }
  }

  return `${parts.join("\n\n")}\n`;
}

/**
 * استخراجِ نشانه‌ها برای اعمال در زمان اجرا (مثلاً توسط ویرایشگر تم).
 * خروجی را می‌توان مستقیماً به `element.style.setProperty` داد.
 */
export function themeVariablesFor(config: ThemeConfig, mode: ThemeMode): Record<string, string> {
  return flattenTokenSet(config.modes[mode]);
}
