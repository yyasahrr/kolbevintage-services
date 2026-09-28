/**
 * پاسبانِ کپیِ فارسی در پورتال تأمین‌کننده.
 *
 * چرا اسکن منبع و نه رندر؟ `supplier-src` با runtime کلاسیک JSX نوشته شده و بخش‌هایی
 * از آن فقط داخل مرورگر معنا پیدا می‌کند؛ اسکن متن‌های قابل‌نمایش قطعی‌تر است و
 * رگرسیون «برچسب لاتین» را همان‌جا که نوشته می‌شود می‌گیرد.
 *
 * قاعدهٔ کاربر: هیچ متن لاتینی در رابط نباشد (پرسش ۲۲). تنها استثناها:
 *  • رشته‌های فنی (className، ایمیل، آی‌دی، کلید localStorage، نوع API)
 *  • کدهای ماشینی که در `data-*` نگه داشته می‌شوند، نه در متن دیده‌شدنی
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "supplier-src");
const FILES = ["App.tsx", "features.tsx", "workflows.tsx", "components.tsx", "command-palette.tsx", "data.ts", "api.ts", "features.tsx"];

const LATIN = /[A-Za-z]/;
const PERSIAN = /[\u0600-\u06FF]/;
/** واژه‌های لاتینی که اگر در متن دیده‌شدنی بیایند، شکست محسوب می‌شوند. */
const BANNED_WORDS = /\b(RFQ|SKU|CSV|SLA|QC|PO|MOQ|MB|KB|PDF|Supplier|Vintage|Kolbe|Polybag|Quantity|WebSocket)\b/;

/** استخراج متن‌های دیده‌شدنی: متن JSX، رشته‌های دارای حرف فارسی، و ویژگی‌های متنی. */
function visibleCopy(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/>([^<>{}"=;()\[\]\n]{2,160})</g)) {
    const text = match[1].trim();
    // فقط متن خالصِ JSX؛ اگر نشانهٔ کد/ویژگی در آن باشد، متن دیده‌شدنی نیست.
    if (text && !/["'=;(){}]|className|=>/.test(text)) out.push(text);
  }
  for (const match of source.matchAll(/'([^'\n]{2,160})'|"([^"\n]{2,160})"/g)) {
    const text = (match[1] ?? match[2]).trim();
    // رشته‌های فنی (کلاس CSS، شناسه، نشانه‌گذاری JSX) متن دیده‌شدنی نیستند.
    if (PERSIAN.test(text) && !/[<>{};=]|[a-z]-[a-z]+:|\bpx\b|className/.test(text)) out.push(text);
  }
  for (const match of source.matchAll(/(?:eyebrow|title|label|text|note|placeholder|aria-label|subtitle)="([^"]{2,160})"/g)) {
    out.push(match[1].trim());
  }
  return [...new Set(out)];
}

describe("کپی پورتال تأمین‌کننده — فارسی محض", () => {
  it("هیچ برچسب یا جملهٔ فارسی‌ای حرف لاتین ندارد", () => {
    const offenders: string[] = [];
    for (const file of [...new Set(FILES)]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const text of visibleCopy(source)) {
        // رشته‌های فنی و کلیدها را نادیده می‌گیریم (CSS، شناسه، نشانی، ایمیل).
        if (/^(?:https?:|mailto:|#|\/|--|kv_|col:|grid|flex|absolute|relative|fixed|sticky|inline|block|none|auto)/.test(text)) continue;
        if (PERSIAN.test(text) && LATIN.test(text)) offenders.push(`${file}: ${text}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("واژه‌های لاتین ممنوع در متن دیده‌شدنی تکرار نشده‌اند", () => {
    const offenders: string[] = [];
    for (const file of [...new Set(FILES)]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const text of visibleCopy(source)) {
        if (PERSIAN.test(text) && BANNED_WORDS.test(text)) offenders.push(`${file}: ${text}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("کدهای ماشینی در متن فارسی جا نمانده‌اند (PO-/RFQ-/QC-/SKU-)", () => {
    const offenders: string[] = [];
    const pattern = /\b(?:PO|RFQ|QC|ST|KV)-\d+/;
    for (const file of [...new Set(FILES)]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const text of visibleCopy(source)) {
        if (PERSIAN.test(text) && pattern.test(text)) offenders.push(`${file}: ${text}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
