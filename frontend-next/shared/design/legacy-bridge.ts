/**
 * پلِ بین نشانه‌های قدیمی و نشانه‌های معنایی (فاز ۶.۱).
 *
 * سیستمِ تمِ فعلی (`storefront/designSystem.ts`) مجموعه‌ای از ده رنگ را روی
 * متغیرهای `--kv-*` و `--site-*` می‌نشاند. این پل باعث می‌شود همان‌جا نشانه‌های
 * معناییِ تازه هم به‌روز شوند تا دو سیستم از هم جدا نیفتند.
 *
 * قواعد:
 *  - فقط نشانه‌هایی منتقل می‌شوند که در مدلِ قدیمی معادل دارند. نشانه‌هایی مانند
 *    `success`/`warning`/`error` که در مدلِ قدیمی نبوده‌اند، مقدارِ پیش‌فرضِ خود را
 *    از `tokens.css` نگه می‌دارند (رفتارِ فعلی هم همین بود: `applyDesignSystem`
 *    آن‌ها را تغییر نمی‌داد).
 *  - این تابع هیچ مقداری اختراع نمی‌کند؛ فقط نام‌ها را ترجمه می‌کند.
 */

import { tokenVariableName } from "./tokens";

export type LegacyThemeTokens = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  accent: string;
  border: string;
  focus: string;
};

const LEGACY_TO_SEMANTIC: ReadonlyArray<[keyof LegacyThemeTokens, string]> = [
  ["background", "background"],
  ["surface", "surface"],
  ["surfaceMuted", "surfaceMuted"],
  ["text", "text"],
  ["muted", "muted"],
  ["primary", "primary"],
  ["primaryText", "primaryText"],
  ["accent", "accent"],
  ["border", "border"],
  ["focus", "focus"],
];

/** خروجی: نگاشتِ «نام متغیر معنایی ← مقدار» آماده برای `style.setProperty`. */
export function semanticColorVariablesFromLegacy(tokens: LegacyThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [legacyKey, semanticName] of LEGACY_TO_SEMANTIC) {
    variables[tokenVariableName("color", semanticName)] = tokens[legacyKey];
  }
  return variables;
}
