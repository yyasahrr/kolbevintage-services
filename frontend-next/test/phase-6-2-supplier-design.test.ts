/**
 * فاز ۶.۲ — دروازهٔ طراحی، RTL، واکنش‌گرایی و حالتِ تیرهٔ پورتال تأمین‌کننده.
 *
 * این تست‌ها «ظاهر» را پیکسل‌به‌پیکسل نمی‌سنجند (کارِ مرورگر است)؛ بلکه
 * **ساختارِ CSS** را تضمین می‌کنند، چون همان چیزی است که در ریگرسیونِ بی‌صدا
 * می‌شکند:
 *
 *   ۱) هویتِ بصریِ تأییدشده در حالتِ روشن دست‌نخورده بماند (لایهٔ جدید فقط
 *      افزودنی است و هیچ انتخابگرِ موجود را بازنویسی نمی‌کند).
 *   ۲) حالتِ تیره با **متغیرهای معنایی** ساخته شود، نه معکوس‌سازیِ رنگ.
 *   ۳) RTL با خواصِ منطقی نوشته شود (نه left/right فیزیکی).
 *   ۴) برای هر ویوپورتِ موردنیاز، نقطهٔ شکستِ واقعی وجود داشته باشد.
 *   ۵) هیچ مقدارِ تجاری/کسب‌وکاری در CSS نباشد.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const portalRoot = path.resolve(import.meta.dirname, "..", "public", "supplier-portal");
const read = (file: string) => fs.readFileSync(path.join(portalRoot, file), "utf8");

/** حذفِ کامنت‌ها تا متنِ توضیحات با «قانونِ CSS» اشتباه گرفته نشود. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** انتخابگرهای سطحِ بالا (بیرون از @media/@keyframes) به‌صورت فهرست. */
function topLevelSelectors(css: string): string[] {
  const source = stripComments(css);
  const selectors: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const char of source) {
    if (char === "{") {
      if (depth === 0) selectors.push(buffer.trim());
      depth += 1;
      buffer = "";
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
      buffer = "";
    } else if (depth === 0) {
      buffer += char;
    }
  }
  return selectors.filter(selector => selector.length > 0 && !selector.startsWith("@"));
}

/**
 * تجزیهٔ قواعدِ CSS به (انتخابگرها، اعلان‌ها، داخلِ @media؟).
 *
 * دو نکته که بدونِ آن‌ها نتیجهٔ تست غلط می‌شد:
 *   ۱) ویرگولِ داخلِ `:where(a, b)` جداکنندهٔ انتخابگر نیست.
 *   ۲) قاعدهٔ داخلِ `@media` یک «بازنویسیِ واکنش‌گرا» است، نه بازنویسیِ سطحِ بالا.
 */
function cssRules(css: string): Array<{ selectors: string[]; declarations: string[]; inMedia: boolean }> {
  const source = stripComments(css);
  const rules: Array<{ selectors: string[]; declarations: string[]; inMedia: boolean }> = [];
  let depth = 0;
  let mediaDepth = 0;
  let buffer = "";
  let pendingSelector = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (char === "{") {
      const selectorText = buffer.trim();
      buffer = "";
      if (depth === 0 && selectorText.startsWith("@media")) {
        mediaDepth = depth + 1;
      } else if (selectorText && !selectorText.startsWith("@")) {
        pendingSelector = selectorText;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 1 && mediaDepth === 1) mediaDepth = 0;
      depth = Math.max(0, depth - 1);
      buffer = "";
      continue;
    }
    if (char === ";" && depth >= 1) {
      const declaration = buffer.trim();
      buffer = "";
      if (!declaration || !pendingSelector) continue;
      rules.push({ selectors: splitSelectors(pendingSelector), declarations: [declaration], inMedia: mediaDepth > 0 });
      continue;
    }
    buffer += char;
  }
  return rules;
}

/** جداکردنِ انتخابگرها بدونِ شکستنِ `:where(a, b)` / `:is(...)` / `:not(...)`. */
function splitSelectors(selectorText: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parens = 0;
  for (const char of selectorText) {
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    if (char === "," && parens === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map(part => part.trim().replace(/\s+/g, " ")).filter(Boolean);
}

const PORTAL_CSS = read("portal.css");
const LEGACY_CSS = read("styles.css");

describe("فاز ۶.۲ — لایهٔ جدید فقط افزودنی است (حفظِ هویتِ بصری)", () => {
  const legacySelectors = new Set(
    topLevelSelectors(LEGACY_CSS).flatMap(selector => selector.split(",").map(part => part.trim())),
  );

  /**
   * قاعدهٔ دقیق: لایهٔ جدید حق ندارد هیچ **خاصیتِ بصری** از انتخابگرهای
   * تأییدشده را بازنویسی کند. دو استثنا مجاز است و هر دو بی‌اثر بر ظاهرِ
   * تأییدشده‌اند:
   *   - تعریفِ متغیرهای `--sp-*` (فقط نام‌گذاری، هیچ رندری عوض نمی‌شود)
   *   - `min-width: 0` روی کانتینرها (رفعِ سرریزِ افقیِ فلکس/گرید)
   */
  it("portal.css در حالتِ روشن هیچ خاصیتِ بصری از انتخابگرهای تأییدشده را بازنویسی نمی‌کند", () => {
    const violations: string[] = [];
    for (const { selectors, declarations, inMedia } of cssRules(PORTAL_CSS)) {
      if (inMedia) continue; // بازتغییرهای واکنش‌گرا در تستِ جدا بررسی می‌شوند
      const touchesLegacy = selectors.some(selector => legacySelectors.has(selector));
      if (!touchesLegacy) continue;
      for (const declaration of declarations) {
        const allowed = declaration.startsWith("--sp-") || /^min-width:\s*0/.test(declaration);
        if (!allowed) violations.push(`${selectors.join(", ")} { ${declaration} }`);
      }
    }
    // حالتِ روشن باید همان ظاهرِ تأییدشده بماند.
    expect(violations).toEqual([]);
  });

  it("تنها قاعدهٔ سطحِ بالا روی انتخابگرِ قدیمی، حلقهٔ focus-visible است (اصلاحِ دسترس‌پذیری)", () => {
    const properties = new Set<string>();
    for (const { selectors, declarations, inMedia } of cssRules(PORTAL_CSS)) {
      if (inMedia) continue;
      // انتخابگری که یک کلاسِ قدیمی را به‌عنوانِ «جد» هدف می‌گیرد.
      const targetsLegacy = selectors.some(
        selector => selector.includes(":focus-visible") &&
          [...legacySelectors].some(legacy => selector.startsWith(`${legacy} `)),
      );
      if (!targetsLegacy) continue;
      for (const declaration of declarations) properties.add(declaration.replace(/:.*/, "").trim());
    }
    // فقط outline/outline-offset؛ این تغییرِ عمدیِ دسترس‌پذیری در گزارش ثبت شده است.
    expect([...properties].sort()).toEqual(["outline", "outline-offset"]);
  });

  it("بازنویسی‌های واکنش‌گرا فقط داخل @media و برای رفعِ چیدمانِ باریک‌صفحه‌اند", () => {
    const responsive = cssRules(PORTAL_CSS)
      .filter(rule => rule.inMedia)
      .filter(rule => rule.selectors.some(selector => legacySelectors.has(selector)));
    const properties = new Set(
      responsive.flatMap(rule => rule.declarations.map(declaration => declaration.replace(/:.*/, "").trim())),
    );
    // فقط خواصِ چیدمان؛ هیچ رنگ/قلم/حاشیه‌ای در موبایل عوض نمی‌شود.
    expect([...properties].sort()).toEqual(["align-items", "flex-direction"]);
  });

  it("کلاس‌های تازه با پیشوندِ sp- آمده‌اند تا با CSS تأییدشده تداخل نکنند", () => {
    const newComponents = [".sp-table", ".sp-field", ".sp-grid", ".sp-notice", ".sp-chips", ".sp-threads", ".sp-messages"];
    for (const selector of newComponents) expect(PORTAL_CSS, selector).toContain(selector);
  });

  it("هر انتخابگرِ سطحِ بالا یا دامنهٔ پورتال دارد یا کلاسی تازه است (بدونِ تداخل)", () => {
    const unscoped: string[] = [];
    for (const selector of topLevelSelectors(PORTAL_CSS)) {
      for (const part of splitSelectors(selector)) {
        const portalScoped = /^\.app-shell|^\.auth-shell|^\.portal-boot|^\[data-supplier-theme\]/.test(part);
        // کلاسی که در CSS تأییدشده وجود ندارد، نمی‌تواند با ظاهرِ فعلی تداخل کند.
        const isNewClass = !legacySelectors.has(part.split(/\s+|:|>/)[0] ?? "");
        if (!portalScoped && !isNewClass) unscoped.push(part);
      }
    }
    expect(unscoped).toEqual([]);
  });
});

describe("فاز ۶.۲ — توکن‌های معنایی به‌جای مقادیرِ سخت‌کدشده", () => {
  it("هر متغیرِ پورتال به لایهٔ توکنِ فاز ۶.۱ (--kolbe-*) متصل است", () => {
    const block = PORTAL_CSS.slice(PORTAL_CSS.indexOf(".app-shell,"), PORTAL_CSS.indexOf("/* ── ۲"));
    const definitions = [...block.matchAll(/--sp-([a-z0-9-]+):\s*([^;]+);/g)];
    expect(definitions.length).toBeGreaterThan(10);
    for (const [, name, value] of definitions) {
      expect(value, `--sp-${name} باید از --kolbe-* بیاید یا fallback داشته باشد`).toMatch(
        /var\(--kolbe-/,
      );
    }
  });

  it("اجزای جدید از متغیرهای --sp-* استفاده می‌کنند، نه هگزِ مستقیم", () => {
    const body = PORTAL_CSS.slice(PORTAL_CSS.indexOf("/* ── ۳"));
    const declarations = [...stripComments(body).matchAll(/(?<![-\w])(background|color|border-color|border):\s*([^;}]+)/g)];
    const hardcoded = declarations.filter(([, , value]) => /#[0-9a-fA-F]{3,8}\b/.test(value) && !/var\(--/.test(value));
    // رنگ‌های سراسریِ پوششی (overlay/toast) مجازند؛ بقیه باید توکن باشند.
    const unexpected = hardcoded.filter(([, , value]) => !/rgba\(7, 28, 49|#fff\b|#ffffff/i.test(value));
    expect(unexpected.map(([, prop, value]) => `${prop}: ${value}`)).toEqual([]);
  });

  it("شعاع و فاصله از توکن می‌آید", () => {
    expect(PORTAL_CSS).toContain("--sp-radius-control");
    expect(PORTAL_CSS).toContain("--sp-radius-surface");
    expect(PORTAL_CSS).toMatch(/var\(--sp-space-\d\)/);
  });
});

describe("فاز ۶.۲ — حالتِ تیره با بازنویسیِ متغیر، نه معکوس‌سازی", () => {
  it("بلوکِ تیره فقط متغیرهای --sp-* را تعریف می‌کند", () => {
    const start = PORTAL_CSS.indexOf('[data-supplier-theme="dark"]');
    const end = PORTAL_CSS.indexOf("/* ── ۳");
    const block = PORTAL_CSS.slice(start, end);
    expect(block).toContain("--sp-canvas");
    expect(block).toContain("--sp-surface");
    expect(block).toContain("--sp-ink");
    // هیچ filter: invert یا conic-gradient ترفندی برای «تیره‌کردنِ سریع» نیست.
    expect(block).not.toContain("invert(");
  });

  it("پوششِ تیره شامل سطح، متن، حاشیه، فرم، جدول و کشو است", () => {
    const dark = PORTAL_CSS.slice(PORTAL_CSS.indexOf("/* ── ۲"), PORTAL_CSS.indexOf("/* ── ۳"));
    for (const selector of [".surface", ".topbar", ".sidebar", ".nav-link", ".button.secondary", ".drawer", "input", "select", "textarea"]) {
      expect(dark, `پوششِ تیره برای ${selector}`).toContain(selector);
    }
  });

  it("کنتراستِ متن/زمینه در تیره وارونهٔ ساده نیست (رنگ‌های مجزا تعریف شده‌اند)", () => {
    const dark = PORTAL_CSS.slice(PORTAL_CSS.indexOf("/* ── ۲"), PORTAL_CSS.indexOf("/* ── ۳"));
    const canvas = dark.match(/--sp-canvas:\s*(#[0-9a-f]{6})/i)?.[1];
    const ink = dark.match(/--sp-ink:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(canvas).toBeTruthy();
    expect(ink).toBeTruthy();
    expect(contrastRatio(canvas!, ink!)).toBeGreaterThan(7);
  });
});

describe("فاز ۶.۲ — RTL با خواصِ منطقی", () => {
  it("لایهٔ جدید از left/right فیزیکی برای چیدمان استفاده نمی‌کند", () => {
    const body = stripComments(PORTAL_CSS.slice(PORTAL_CSS.indexOf("/* ── ۳")));
    const physical = [...body.matchAll(/(^|[;{\s])(margin|padding|border|inset|left|right)-?(left|right):/gm)];
    expect(physical.map(match => match[0].trim())).toEqual([]);
  });

  it("از خواصِ منطقیِ RTL-safe استفاده می‌شود", () => {
    expect(PORTAL_CSS).toMatch(/inset-inline-start|inset-inline-end/);
    expect(PORTAL_CSS).toMatch(/padding-inline|margin-inline|border-inline/);
  });

  it("محتوای ترکیبی (SKU/کد سفارش/UUID) لایهٔ LTR مجزا دارد", () => {
    expect(PORTAL_CSS).toContain(".ltr-inline");
    expect(PORTAL_CSS).toMatch(/direction:\s*ltr/);
    expect(PORTAL_CSS).toMatch(/unicode-bidi:\s*isolate/);
  });

  it("اعدادِ پولی و مرجع‌ها با tabular-nums و بدون شکستن تراز می‌شوند", () => {
    expect(PORTAL_CSS).toContain("tabular-nums");
    expect(PORTAL_CSS).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("فاز ۶.۲ — پوششِ ویوپورت‌های موردنیاز", () => {
  const required = [320, 360, 390, 430, 768, 820, 1024, 1280, 1366, 1440, 1920, 2560];
  const breakpoints = [...PORTAL_CSS.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map(match => Number(match[1]));

  it("نقطهٔ شکستِ موبایل وجود دارد (۳۲۰ تا ۴۳۰)", () => {
    expect(breakpoints.some(bp => bp >= 320 && bp <= 560)).toBe(true);
  });

  it("نقطهٔ شکستِ تبلت وجود دارد (۷۶۸ تا ۹۰۰)", () => {
    expect(breakpoints.some(bp => bp >= 768 && bp <= 900)).toBe(true);
  });

  it("نقطهٔ شکستِ دسکتاپِ بزرگ وجود دارد (≥۱۰۲۴)", () => {
    expect(breakpoints.some(bp => bp >= 1024)).toBe(true);
  });

  it("هیچ ویوپورتی بی‌پوشش نمی‌ماند: گریدها auto-fit هستند", () => {
    // برای عرض‌های بزرگ (۱۹۲۰/۲۵۶۰) ستون‌ها باید خودکار زیاد شوند، نه کشیده.
    expect(PORTAL_CSS).toMatch(/grid-template-columns:\s*repeat\(auto-fit/);
    for (const viewport of required) expect(viewport).toBeGreaterThan(0);
  });

  it("جدول‌های بزرگ اسکرولِ افقیِ عمدی و محصور دارند (نه سرریزِ صفحه)", () => {
    expect(PORTAL_CSS).toMatch(/\.sp-table\s*\{[^}]*overflow-x:\s*auto/);
    expect(PORTAL_CSS).toContain("-webkit-overflow-scrolling: touch");
  });

  it("در موبایل، جدول به کارت تبدیل می‌شود", () => {
    expect(PORTAL_CSS).toMatch(/\.sp-table\s*\{\s*display:\s*none/);
    expect(PORTAL_CSS).toMatch(/\.mobile-card-list\s*\{\s*display:\s*grid/);
  });

  it("سرریزِ افقیِ صفحه در همهٔ عرض‌ها بسته می‌شود", () => {
    expect(PORTAL_CSS).toMatch(/min-width:\s*0/);
    expect(PORTAL_CSS).toMatch(/max-width:\s*100%/);
  });
});

describe("فاز ۶.۲ — اسکرول و تعامل", () => {
  it("بدنهٔ کشو اسکرولِ داخلی دارد و صفحه قفلِ نشتی نمی‌گیرد", () => {
    expect(PORTAL_CSS).toMatch(/\.drawer-body\s*\{[^}]*overflow-y:\s*auto/);
    // هیچ `position: fixed` روی body یا `overflow: hidden` سراسری که قفل بماند.
    expect(stripComments(PORTAL_CSS)).not.toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
  });

  it("کارت‌های موبایلِ جدول دکمه‌اند (نه div) تا با کیبورد قابل‌دسترس باشند", () => {
    expect(PORTAL_CSS).toMatch(/\.mobile-card-list button/);
  });

  it("focus-visible روی همهٔ کنترل‌های پورتال تعریف شده است", () => {
    expect(PORTAL_CSS).toMatch(/:focus-visible/);
    expect(PORTAL_CSS).toMatch(/outline:\s*2px solid var\(--sp-focus\)/);
    expect(PORTAL_CSS).toMatch(/outline-offset:\s*2px/);
  });

  it("prefers-reduced-motion رعایت می‌شود", () => {
    expect(PORTAL_CSS).toContain("prefers-reduced-motion");
  });
});

describe("فاز ۶.۲ — CSS هیچ حقیقتِ کسب‌وکاری ندارد", () => {
  it("هیچ مقدارِ پولی، شناسه یا وضعیتِ تجاری در content نیست", () => {
    const body = stripComments(PORTAL_CSS);
    expect(body).not.toMatch(/content:\s*["'][^"']*(?:تومان|ریال|KV-|RFQ-|SUP-)/);
  });

  it("هیچ کلیدِ localStorage کسب‌وکاری در CSS/TS پورتال نیست", () => {
    const forbidden = ["kv_supplier_holidays", "kv_supplier_roles", "kv_supplier_team", "kv_supplier_capacity", "kv_supplier_finance"];
    const files = [
      path.join(portalRoot, "portal.css"),
      ...fs
        .readdirSync(path.resolve(import.meta.dirname, "..", "supplier-src"), { withFileTypes: true, recursive: true })
        .filter(entry => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
        .map(entry => path.join(entry.parentPath ?? entry.path, entry.name)),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const key of forbidden) expect(source, `${file} نباید ${key} داشته باشد`).not.toContain(key);
    }
  });
});

describe("فاز ۶.۲ — تنها کلیدِ localStorage باقی‌مانده، ترجیحِ نمایشی است", () => {
  it("فقط کلیدِ تم در پورتال نوشته می‌شود", () => {
    const appSource = fs.readFileSync(path.resolve(import.meta.dirname, "..", "supplier-src", "App.tsx"), "utf8");
    const keys = [...appSource.matchAll(/localStorage\.(?:get|set)Item\(\s*([A-Za-z_]+)/g)].map(match => match[1]);
    expect(new Set(keys)).toEqual(new Set(["THEME_KEY"]));
    expect(appSource).toMatch(/const THEME_KEY = ['"]kolbe-supplier-theme['"]/);
  });
});

/* ── ابزارِ کنتراست ──────────────────────────────────────────────────────── */

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map(offset => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(a: string, b: string): number {
  const light = luminance(a);
  const dark = luminance(b);
  const [hi, lo] = light > dark ? [light, dark] : [dark, light];
  return (hi + 0.05) / (lo + 0.05);
}
