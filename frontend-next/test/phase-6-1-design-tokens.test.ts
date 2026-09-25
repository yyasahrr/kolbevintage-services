/**
 * تست‌های بنیادِ نشانه‌های طراحی (فاز ۶.۱-F/G/H/I).
 *
 * این تست‌ها ثابت می‌کنند:
 *  ۱. مجموعه نشانه‌ها در هر دو حالتِ روشن/تاریک کامل است؛
 *  ۲. فایلِ CSSِ کامیت‌شده دقیقاً خروجیِ مولد است (بدون انحراف)؛
 *  ۳. نشانه‌های متنی کنتراستِ کافی دارند (مستندسازیِ یک استثنا)؛
 *  ۴. پایه RTL-safe است و هیچ ویژگیِ فیزیکی ندارد؛
 *  ۵. مدل برای ویرایشگر بصریِ فاز ۶.۴ قابل سریال‌سازی و لغو است؛
 *  ۶. کلاس‌های viewportِ هدف پوشش داده شده‌اند.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BREAKPOINTS,
  COLOR_TOKENS,
  CONTROL_TOKENS,
  DARK_TOKENS,
  DEFAULT_THEME,
  LAYOUT_TOKENS,
  LEGACY_VARIABLE_ALIASES,
  LIGHT_TOKENS,
  SHAPE_TOKENS,
  THEME_MODES,
  TYPOGRAPHY_TOKENS,
  flattenTokenSet,
  mergeTokenSets,
  tokenNamesOf,
  tokenVariableName,
  type ThemeConfig,
  type ThemeTokenSet,
} from "../shared/design/tokens";
import { generateThemeCss, themeVariablesFor } from "../shared/design/css";
import { semanticColorVariablesFromLegacy } from "../shared/design/legacy-bridge";
import { RESPONSIVE_VIEWPORT_MATRIX, tierForWidth } from "./fixtures/viewports";

const designDir = path.resolve(import.meta.dirname, "..", "shared", "design");
const committedCss = readFileSync(path.join(designDir, "tokens.css"), "utf8");
const foundationCss = readFileSync(path.join(designDir, "foundation.css"), "utf8");
const layoutSource = readFileSync(path.resolve(import.meta.dirname, "..", "app", "layout.tsx"), "utf8");
const globalsCss = readFileSync(path.resolve(import.meta.dirname, "..", "app", "globals.css"), "utf8");

function parseHex(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`رنگ هگز معتبر نیست: ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(value: string): number {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("Phase 6.1-F design token foundation", () => {
  it("covers every required semantic token group", () => {
    expect(COLOR_TOKENS).toContain("background");
    expect(COLOR_TOKENS).toContain("surface");
    expect(COLOR_TOKENS).toContain("surfaceElevated");
    expect(COLOR_TOKENS).toContain("primary");
    expect(COLOR_TOKENS).toContain("text");
    expect(COLOR_TOKENS).toContain("textSecondary");
    expect(COLOR_TOKENS).toContain("muted");
    expect(COLOR_TOKENS).toContain("border");
    expect(COLOR_TOKENS).toContain("accent");
    expect(COLOR_TOKENS).toContain("success");
    expect(COLOR_TOKENS).toContain("warning");
    expect(COLOR_TOKENS).toContain("error");
    expect(COLOR_TOKENS).toContain("focus");

    expect(TYPOGRAPHY_TOKENS).toEqual(expect.arrayContaining(["fontFamily", "sizeDisplay", "sizeH1", "sizeBody", "sizeMeta", "weightBold"]));
    expect(LAYOUT_TOKENS).toEqual(expect.arrayContaining(["containerDefault", "gutter", "sectionSpace", "gridGap"]));
    expect(SHAPE_TOKENS).toEqual(expect.arrayContaining(["radiusControl", "radiusSurface", "borderWidth", "shadowCard", "shadowOverlay"]));
    expect(CONTROL_TOKENS).toEqual(expect.arrayContaining(["controlHeight", "cardPadding", "dialogWidth", "drawerWidth", "tableCellPaddingInline"]));
  });

  it("defines the same token names for light and dark", () => {
    const light = flattenTokenSet(LIGHT_TOKENS);
    const dark = flattenTokenSet(DARK_TOKENS);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(
      COLOR_TOKENS.length + TYPOGRAPHY_TOKENS.length + LAYOUT_TOKENS.length + SHAPE_TOKENS.length + CONTROL_TOKENS.length,
    );
    for (const [name, value] of Object.entries(light)) {
      expect(value.trim().length, name).toBeGreaterThan(0);
      expect(dark[name].trim().length, name).toBeGreaterThan(0);
    }
  });

  it("keeps the approved default values (heritage identity)", () => {
    expect(LIGHT_TOKENS.color.primary).toBe("#0b2a46");
    expect(LIGHT_TOKENS.color.background).toBe("#f7f5f0");
    expect(LIGHT_TOKENS.typography.fontFamily).toContain("Vazirmatn");
    expect(LIGHT_TOKENS.shape.radiusControl).toBe("0.625rem");
    expect(LIGHT_TOKENS.shape.shadowOverlay).toContain("rgba(7, 28, 49");
    expect(DEFAULT_THEME.id).toBe("heritage");
  });

  it("committed tokens.css matches the generator output (no drift)", () => {
    expect(committedCss).toBe(generateThemeCss(DEFAULT_THEME));
  });

  it("emits light and dark blocks plus the mode marker", () => {
    expect(committedCss).toContain(':root, [data-kolbe-mode="light"]');
    expect(committedCss).toContain('[data-theme="dark"], [data-kolbe-mode="dark"]');
    expect(committedCss).toContain("--kolbe-mode: dark;");
    expect(committedCss).toContain("--kolbe-mode: light;");
  });

  it("keeps contrast readable for text tokens in both modes", () => {
    const pairs: Array<[string, string, number]> = [
      ["text", "background", 4.5],
      ["text", "surface", 4.5],
      ["textSecondary", "background", 4.5],
      ["muted", "background", 4.5],
      ["muted", "surface", 4.5],
      ["success", "background", 4.5],
      ["warning", "background", 4.5],
      ["error", "background", 4.5],
      ["focus", "background", 3],
    ];
    for (const mode of THEME_MODES) {
      const tokens = DEFAULT_THEME.modes[mode];
      for (const [foreground, background, minimum] of pairs) {
        const ratio = contrast(tokens.color[foreground as keyof typeof tokens.color], tokens.color[background as keyof typeof tokens.color]);
        expect(ratio, `${mode}: ${foreground} روی ${background}`).toBeGreaterThanOrEqual(minimum);
      }
      // متنِ روی دکمه/برچسبِ اصلی:
      expect(contrast(tokens.color.primaryText, tokens.color.primary), `${mode}: primaryText`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("documents the single accent contrast exception instead of silently changing the brand colour", () => {
    const lightRatio = contrast(LIGHT_TOKENS.color.accentText, LIGHT_TOKENS.color.accent);
    // آجریِ برند با متن سفید برای متنِ ریز حد نصابِ AA را ندارد؛ چون هویت بصری
    // تأیید شده است، تغییر نمی‌دهیم و فقط ثبت می‌کنیم (برای تصمیمِ کارفرما در ۶.۴).
    expect(lightRatio).toBeGreaterThanOrEqual(3);
    expect(lightRatio).toBeLessThan(4.5);
  });
});

describe("Phase 6.1-H future visual-editor compatibility", () => {
  it("keeps the theme model serializable and overridable per breakpoint", () => {
    const config: ThemeConfig = {
      id: "test",
      name: "تست",
      modes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
      responsive: { md: { light: { color: { primary: "#123456" } } } },
    };
    // مدل باید بدون از دست رفتنِ داده JSONپذیر باشد (ذخیره در CMS/DB در فاز ۶.۴):
    expect(JSON.parse(JSON.stringify(config)).id).toBe("test");
    const css = generateThemeCss(config);
    expect(css).toContain(`@media (min-width: ${BREAKPOINTS.md}px)`);
    expect(css).toContain("--kolbe-color-primary: #123456;");
  });

  it("merges partial overrides without dropping untouched tokens", () => {
    const merged: ThemeTokenSet = mergeTokenSets(LIGHT_TOKENS, { color: { accent: "#000000" } });
    expect(merged.color.accent).toBe("#000000");
    expect(merged.color.primary).toBe(LIGHT_TOKENS.color.primary);
    expect(merged.layout).toEqual(LIGHT_TOKENS.layout);
  });

  it("exposes runtime variables for a future theme editor", () => {
    const variables = themeVariablesFor(DEFAULT_THEME, "dark");
    expect(variables["--kolbe-color-background"]).toBe(DARK_TOKENS.color.background);
    expect(Object.keys(variables).length).toBeGreaterThan(60);
  });

  it("maps legacy theme tokens onto the semantic layer", () => {
    const mapped = semanticColorVariablesFromLegacy({
      background: "#ffffff",
      surface: "#fafafa",
      surfaceMuted: "#eeeeee",
      text: "#111111",
      muted: "#666666",
      primary: "#0b2a46",
      primaryText: "#ffffff",
      accent: "#c9654d",
      border: "#dddddd",
      focus: "#547a98",
    });
    expect(mapped[tokenVariableName("color", "background")]).toBe("#ffffff");
    expect(mapped[tokenVariableName("color", "focus")]).toBe("#547a98");
    // نشانه‌هایی که در مدل قدیمی نبوده‌اند، اختراع نمی‌شوند:
    expect(mapped).not.toHaveProperty(tokenVariableName("color", "success"));
  });

  it("documents the legacy variable aliases for incremental migration", () => {
    for (const alias of LEGACY_VARIABLE_ALIASES) {
      expect(alias.legacy.startsWith("--")).toBe(true);
      expect(alias.token.startsWith("--kolbe-")).toBe(true);
    }
    expect(LEGACY_VARIABLE_ALIASES.some((alias) => alias.legacy === "--kv-canvas")).toBe(true);
  });

  it("keeps token names stable across groups", () => {
    for (const group of ["color", "typography", "layout", "shape", "control"] as const) {
      for (const name of tokenNamesOf(group)) {
        expect(tokenVariableName(group, name)).toMatch(/^--kolbe-[a-z]+-[a-z0-9-]+$/);
      }
    }
  });
});

describe("Phase 6.1-I responsive, RTL and theme quality", () => {
  it("uses only logical properties in the foundation layer", () => {
    const physical = /(^|[^-\w])(margin|padding)-(left|right)\s*:|(^|[^-\w])(left|right)\s*:\s*-?\d|text-align\s*:\s*(left|right)/;
    expect(foundationCss).not.toMatch(physical);
    expect(foundationCss).toContain("margin-inline: auto");
    expect(foundationCss).toContain("padding-inline");
  });

  it("isolates mixed Persian/Latin content and prevents horizontal overflow", () => {
    expect(foundationCss).toContain("direction: ltr");
    expect(foundationCss).toContain("unicode-bidi: isolate");
    expect(foundationCss).toContain("font-variant-numeric: tabular-nums");
    // min-width: 0 روی فرزندانِ grid/flex عاملِ اصلیِ رفعِ سرریز است:
    expect(foundationCss).toContain(".kolbe-min-0");
    expect(foundationCss).toContain("min-width: 0");
    // جدول در صفحه‌های باریک در خودش اسکرول می‌خورد، نه در کل صفحه:
    expect(foundationCss).toContain("overflow-x: auto");
  });

  it("keeps the document direction RTL and provides a consistent focus treatment", () => {
    expect(layoutSource).toContain('dir="rtl"');
    expect(layoutSource).toContain('lang="fa"');
    expect(foundationCss).toContain("outline: 2px solid var(--kolbe-color-focus)");
    expect(globalsCss).toContain("focus-visible");
  });

  it("covers the target viewport matrix with fluid layout tokens", () => {
    expect(RESPONSIVE_VIEWPORT_MATRIX).toHaveLength(12);
    const widths = RESPONSIVE_VIEWPORT_MATRIX.map((viewport) => viewport.width);
    expect(Math.min(...widths)).toBe(320);
    expect(Math.max(...widths)).toBe(2560);
    for (const viewport of RESPONSIVE_VIEWPORT_MATRIX) {
      expect(tierForWidth(viewport.width)).toBe(viewport.tier);
    }

    // هیچ عرضِ ثابتی که در ۳۲۰px سرریز کند تعریف نشده است:
    const layout = LIGHT_TOKENS.layout;
    expect(layout.gutter).toContain("clamp(");
    expect(layout.gridGap).toContain("clamp(");
    expect(layout.sectionSpace).toContain("clamp(");
    const gridMin = foundationCss.match(/minmax\(min\(100%,\s*([\d.]+rem)\)/);
    expect(gridMin).not.toBeNull();
    // ۱۵rem = ۲۴۰px و با gutter جمعاً کمتر از ۳۲۰px می‌ماند:
    expect(Number.parseFloat(gridMin?.[1] ?? "0")).toBeLessThanOrEqual(15);

    // breakpointهای اعلام‌شده با کلاس‌های واقعیِ دستگاه‌ها هم‌خوان است:
    expect(BREAKPOINTS.md).toBe(768);
    expect(BREAKPOINTS.lg).toBe(1024);
    expect(tierForWidth(767)).toBe("mobile");
    expect(tierForWidth(1024)).toBe("desktop");
  });

  it("adds only additive styles: no existing selector is redefined", () => {
    // نشانه‌ها فقط متغیر تعریف می‌کنند و هیچ قانونِ ظاهری را تغییر نمی‌دهند.
    const withoutComments = committedCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const declarations = withoutComments.split("\n").filter((line) => line.includes(":"));
    for (const line of declarations) {
      expect(line.trim().startsWith("--kolbe-") || line.trim().startsWith("color-scheme") || line.trim().startsWith("}") || line.includes("{")).toBe(true);
    }
    expect(committedCss).not.toContain("body {");
    expect(committedCss).not.toContain(".storefront-shell");
  });
});
