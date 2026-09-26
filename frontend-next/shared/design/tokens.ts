/**
 * بنیادِ نشانه‌های طراحی (Design Tokens) — فاز ۶.۱.
 *
 * هدف: تبدیلِ «هویت بصریِ فعلی» به یک مجموعه نشانهٔ معنایی و متمرکز، **بدون
 * تغییرِ ظاهر**. مقدارهای پیش‌فرض این فایل همان‌هایی هستند که امروز روی سایت
 * اعمال می‌شود (قالبِ `heritage` در `storefront/designSystem.ts` و متغیرهای
 * `--kv-*` در `app/globals.css`)؛ فقط نام‌گذاری و محلِ نگهداری عوض شده است.
 *
 * چرا نشانه و نه مقدارِ پراکنده؟
 *  ۱. جلوگیری از ناهمگونی: امروز یک رنگ در پنج فایل با پنج مقدارِ نزدیک‌به‌هم
 *     تکرار شده بود (مثلاً `#011c3a`, `#0b2a46`, `#071c31` برای سرمه‌ای).
 *  ۲. آمادگی برای ویرایشگر بصری (فاز ۶.۴): مدلِ داده اینجا همان ساختاری را دارد
 *     که آن ویرایشگر نیاز دارد:
 *
 *         Global Theme → Page Template → Section → Block → Responsive Override
 *
 *     یعنی `ThemeConfig` قابل سریال‌سازی است، دو حالتِ روشن/تاریک دارد و
 *     می‌تواند برای هر breakpoint لغو (override) بخورد — بدون اینکه هیچ مقداری
 *     در سورسِ کامپوننت‌ها حک شود.
 *
 *  ۳. قابلیتِ تست: `shared/design/css.ts` از همین داده CSS تولید می‌کند و تست‌ها
 *     پوششِ نشانه‌ها، کنتراست و RTL را روی همین ساختار بررسی می‌کنند.
 *
 * این فایل هیچ وابستگی به مرورگر/React ندارد و در Node اجرا می‌شود.
 */

/* ── رنگ ─────────────────────────────────────────────────────────────────── */

export const COLOR_TOKENS = [
  "background",
  "surface",
  "surfaceMuted",
  "surfaceElevated",
  "surfaceSunken",
  "primary",
  "primaryHover",
  "primaryText",
  "primarySubtle",
  "text",
  "textSecondary",
  "textInverse",
  "muted",
  "info",
  "infoSurface",
  "border",
  "borderStrong",
  "accent",
  "accentText",
  "success",
  "successSurface",
  "warning",
  "warningSurface",
  "error",
  "errorSurface",
  "focus",
  "glassSurface",
  "glassBorder",
  "overlay",
  "skeleton",
] as const;

export type ColorTokenName = (typeof COLOR_TOKENS)[number];
export type ColorTokens = Record<ColorTokenName, string>;

/* ── تایپوگرافی ──────────────────────────────────────────────────────────── */

export const TYPOGRAPHY_TOKENS = [
  "fontFamily",
  "fontFamilyHeading",
  "fontFamilyCode",
  "sizeDisplay",
  "sizeHero",
  "sizeH1",
  "sizeH2",
  "sizeH3",
  "sizeBody",
  "sizeBodySmall",
  "sizeLabel",
  "sizeMeta",
  "sizeCaption",
  "weightRegular",
  "weightMedium",
  "weightSemibold",
  "weightBold",
  "lineHeightTight",
  "lineHeightHeading",
  "lineHeightBody",
  "lineHeightRelaxed",
  "letterSpacingNormal",
  "letterSpacingWide",
  "letterSpacingTight",
] as const;

export type TypographyTokenName = (typeof TYPOGRAPHY_TOKENS)[number];
export type TypographyTokens = Record<TypographyTokenName, string>;

/* ── چیدمان ──────────────────────────────────────────────────────────────── */

export const LAYOUT_TOKENS = [
  "containerNarrow",
  "containerDefault",
  "containerWide",
  "gutter",
  "space1",
  "space2",
  "space3",
  "space4",
  "space5",
  "space6",
  "space7",
  "space8",
  "sectionSpace",
  "sectionSpaceLarge",
  "gridGap",
  "gridGapLarge",
] as const;

export type LayoutTokenName = (typeof LAYOUT_TOKENS)[number];
export type LayoutTokens = Record<LayoutTokenName, string>;

/* ── فرم و سایه ──────────────────────────────────────────────────────────── */

export const SHAPE_TOKENS = [
  "radiusNone",
  "radiusControl",
  "radiusSurface",
  "radiusCard",
  "radiusPill",
  "borderWidth",
  "borderWidthStrong",
  "shadowCard",
  "shadowOverlay",
] as const;

export type ShapeTokenName = (typeof SHAPE_TOKENS)[number];
export type ShapeTokens = Record<ShapeTokenName, string>;

/* ── کنترل‌ها ────────────────────────────────────────────────────────────── */

export const CONTROL_TOKENS = [
  "controlHeightSmall",
  "controlHeight",
  "controlHeightLarge",
  "controlPaddingInline",
  "controlPaddingBlock",
  "cardPadding",
  "cardGap",
  "dialogWidth",
  "dialogPadding",
  "drawerWidth",
  "drawerPadding",
  "tableCellPaddingInline",
  "tableCellPaddingBlock",
  "tableRowMinHeight",
] as const;

export type ControlTokenName = (typeof CONTROL_TOKENS)[number];
export type ControlTokens = Record<ControlTokenName, string>;

export const MOTION_TOKENS = [
  "durationInstant",
  "durationFast",
  "durationNormal",
  "durationSlow",
  "easeStandard",
  "easeEmphasized",
] as const;
export type MotionTokenName = (typeof MOTION_TOKENS)[number];
export type MotionTokens = Record<MotionTokenName, string>;

export const DENSITY_TOKENS = ["comfortable", "compact", "touchTarget"] as const;
export type DensityTokenName = (typeof DENSITY_TOKENS)[number];
export type DensityTokens = Record<DensityTokenName, string>;

export const Z_INDEX_TOKENS = ["base", "sticky", "dropdown", "overlay", "modal", "toast"] as const;
export type ZIndexTokenName = (typeof Z_INDEX_TOKENS)[number];
export type ZIndexTokens = Record<ZIndexTokenName, string>;

export type TokenGroup = "color" | "typography" | "layout" | "shape" | "control" | "motion" | "density" | "zIndex";

export type ThemeTokenSet = {
  color: ColorTokens;
  typography: TypographyTokens;
  layout: LayoutTokens;
  shape: ShapeTokens;
  control: ControlTokens;
  motion: MotionTokens;
  density: DensityTokens;
  zIndex: ZIndexTokens;
};

export type PartialThemeTokenSet = {
  color?: Partial<ColorTokens>;
  typography?: Partial<TypographyTokens>;
  layout?: Partial<LayoutTokens>;
  shape?: Partial<ShapeTokens>;
  control?: Partial<ControlTokens>;
  motion?: Partial<MotionTokens>;
  density?: Partial<DensityTokens>;
  zIndex?: Partial<ZIndexTokens>;
};

/** breakpointها عدد هستند (نمی‌توان آن‌ها را در متغیر CSS گذاشت و در media query استفاده کرد). */
export const BREAKPOINTS = { sm: 480, md: 768, lg: 1024, xl: 1280, "2xl": 1536, "3xl": 1920 } as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

export const BREAKPOINT_ORDER: readonly BreakpointName[] = ["sm", "md", "lg", "xl", "2xl", "3xl"];

export const THEME_MODES = ["light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export type ResponsiveThemeOverrides = Partial<
  Record<BreakpointName, Partial<Record<ThemeMode, PartialThemeTokenSet>>>
>;

export type ThemeConfig = {
  id: string;
  name: string;
  description?: string;
  modes: Record<ThemeMode, ThemeTokenSet>;
  /** لغوهای وابسته به عرضِ صفحه — نقطهٔ اتصالِ آیندهٔ ویرایشگر بصری. */
  responsive?: ResponsiveThemeOverrides;
};

export const CSS_VAR_PREFIX = "--kolbe-";

/** `surfaceMuted` → `surface-muted`؛ `sizeH1` → `size-h1`. */
export function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function tokenVariableName(group: TokenGroup, name: string): string {
  return `${CSS_VAR_PREFIX}${kebab(group)}-${kebab(name)}`;
}

/** تخت‌کردنِ ساختارِ گروه‌بندی‌شده به نگاشتِ «نام متغیر CSS ← مقدار» (خالص و قطعی). */
export function flattenTokenSet(set: ThemeTokenSet): Record<string, string> {
  const flat: Record<string, string> = {};
  const groups: Array<[TokenGroup, Record<string, string>]> = [
    ["color", set.color],
    ["typography", set.typography],
    ["layout", set.layout],
    ["shape", set.shape],
    ["control", set.control],
    ["motion", set.motion],
    ["density", set.density],
    ["zIndex", set.zIndex],
  ];
  for (const [group, tokens] of groups) {
    for (const [name, value] of Object.entries(tokens)) {
      flat[tokenVariableName(group, name)] = value;
    }
  }
  return flat;
}

/** ادغامِ یک لغو روی مجموعهٔ کامل — برای responsive override و تم‌های آینده. */
export function mergeTokenSets(base: ThemeTokenSet, override?: PartialThemeTokenSet): ThemeTokenSet {
  if (!override) return base;
  return {
    color: { ...base.color, ...(override.color ?? {}) },
    typography: { ...base.typography, ...(override.typography ?? {}) },
    layout: { ...base.layout, ...(override.layout ?? {}) },
    shape: { ...base.shape, ...(override.shape ?? {}) },
    control: { ...base.control, ...(override.control ?? {}) },
    motion: { ...base.motion, ...(override.motion ?? {}) },
    density: { ...base.density, ...(override.density ?? {}) },
    zIndex: { ...base.zIndex, ...(override.zIndex ?? {}) },
  };
}

/* ── مقدارهای پیش‌فرض = هویت بصریِ تأییدشده ────────────────────────────────── */

const SHARED_TYPOGRAPHY: Omit<TypographyTokens, "fontFamily" | "fontFamilyHeading"> = {
  fontFamilyCode: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
  sizeDisplay: "clamp(2.25rem, 5vw, 4.25rem)",
  sizeHero: "clamp(2rem, 4vw, 3.5rem)",
  sizeH1: "clamp(1.75rem, 3vw, 2.5rem)",
  sizeH2: "clamp(1.375rem, 2vw, 1.875rem)",
  sizeH3: "clamp(1.125rem, 1.4vw, 1.375rem)",
  sizeBody: "0.9375rem",
  sizeBodySmall: "0.875rem",
  sizeLabel: "0.8125rem",
  sizeMeta: "0.8125rem",
  sizeCaption: "0.75rem",
  weightRegular: "400",
  weightMedium: "500",
  weightSemibold: "600",
  weightBold: "700",
  lineHeightTight: "1.15",
  lineHeightHeading: "1.3",
  lineHeightBody: "1.75",
  lineHeightRelaxed: "1.9",
  letterSpacingNormal: "0",
  letterSpacingWide: "0.08em",
  letterSpacingTight: "-0.02em",
};

const SHARED_LAYOUT: LayoutTokens = {
  containerNarrow: "52rem",
  containerDefault: "78rem",
  containerWide: "96rem",
  gutter: "clamp(1rem, 4vw, 2.5rem)",
  space1: "0.25rem",
  space2: "0.5rem",
  space3: "0.75rem",
  space4: "1rem",
  space5: "1.5rem",
  space6: "2rem",
  space7: "3rem",
  space8: "4rem",
  sectionSpace: "clamp(2.5rem, 6vw, 5rem)",
  sectionSpaceLarge: "clamp(3.5rem, 8vw, 7rem)",
  gridGap: "clamp(0.75rem, 1.6vw, 1.5rem)",
  gridGapLarge: "clamp(1.25rem, 3vw, 2.5rem)",
};

const SHARED_SHAPE: Omit<ShapeTokens, "shadowCard" | "shadowOverlay"> = {
  radiusNone: "0",
  radiusControl: "0.625rem",
  radiusSurface: "1rem",
  radiusCard: "0.875rem",
  radiusPill: "999px",
  borderWidth: "1px",
  borderWidthStrong: "2px",
};

const SHARED_CONTROL: ControlTokens = {
  controlHeightSmall: "2.25rem",
  controlHeight: "2.75rem",
  controlHeightLarge: "3.25rem",
  controlPaddingInline: "1rem",
  controlPaddingBlock: "0.5rem",
  cardPadding: "clamp(1rem, 2vw, 1.5rem)",
  cardGap: "0.75rem",
  dialogWidth: "32rem",
  dialogPadding: "clamp(1.25rem, 3vw, 2rem)",
  drawerWidth: "26rem",
  drawerPadding: "clamp(1rem, 3vw, 1.75rem)",
  tableCellPaddingInline: "0.75rem",
  tableCellPaddingBlock: "0.625rem",
  tableRowMinHeight: "3rem",
};

const SHARED_MOTION: MotionTokens = {
  durationInstant: "80ms",
  durationFast: "140ms",
  durationNormal: "220ms",
  durationSlow: "360ms",
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeEmphasized: "cubic-bezier(0.16, 1, 0.3, 1)",
};

const SHARED_DENSITY: DensityTokens = {
  comfortable: "1",
  compact: "0.82",
  touchTarget: "2.75rem",
};

const SHARED_Z_INDEX: ZIndexTokens = {
  base: "0",
  sticky: "20",
  dropdown: "30",
  overlay: "40",
  modal: "50",
  toast: "60",
};

const FONT_STACK = '"Vazirmatn", ui-sans-serif, system-ui, sans-serif';

export const LIGHT_TOKENS: ThemeTokenSet = {
  color: {
    background: "#f7f5f0",
    surface: "#fffdfa",
    surfaceMuted: "#efede7",
    surfaceElevated: "#ffffff",
    surfaceSunken: "#e8e5de",
    primary: "#0b2a46",
    primaryHover: "#09233a",
    primaryText: "#ffffff",
    primarySubtle: "#e9edf1",
    text: "#071c31",
    textSecondary: "#17354d",
    textInverse: "#fffdfa",
    muted: "#66727d",
    info: "#35657e",
    infoSurface: "#e7f0f4",
    border: "#d8d3ca",
    borderStrong: "#b9b3a8",
    accent: "#c9654d",
    accentText: "#ffffff",
    success: "#477154",
    successSurface: "#eaf1ec",
    warning: "#8a631c",
    warningSurface: "#f8f0e2",
    error: "#a4463d",
    errorSurface: "#f9ebea",
    focus: "#547a98",
    glassSurface: "rgba(255, 253, 250, 0.82)",
    glassBorder: "rgba(255, 255, 255, 0.68)",
    overlay: "rgba(7, 28, 49, 0.48)",
    skeleton: "#e2ded6",
  },
  typography: { fontFamily: FONT_STACK, fontFamilyHeading: FONT_STACK, ...SHARED_TYPOGRAPHY },
  layout: SHARED_LAYOUT,
  shape: {
    ...SHARED_SHAPE,
    shadowCard: "0 1px 2px rgba(7, 28, 49, 0.06)",
    shadowOverlay: "0 18px 50px rgba(7, 28, 49, 0.14)",
  },
  control: SHARED_CONTROL,
  motion: SHARED_MOTION,
  density: SHARED_DENSITY,
  zIndex: SHARED_Z_INDEX,
};

export const DARK_TOKENS: ThemeTokenSet = {
  color: {
    background: "#10161d",
    surface: "#18222c",
    surfaceMuted: "#202d38",
    surfaceElevated: "#1f2b36",
    surfaceSunken: "#0b1117",
    primary: "#d9bd91",
    primaryHover: "#e6cda6",
    primaryText: "#17130e",
    primarySubtle: "#232f3b",
    text: "#f5f0e8",
    textSecondary: "#d9dee4",
    textInverse: "#18222c",
    muted: "#acb8c2",
    info: "#8fc7df",
    infoSurface: "#172934",
    border: "#354552",
    borderStrong: "#4a5c6b",
    accent: "#e07a61",
    accentText: "#1a100c",
    success: "#7fc79b",
    successSurface: "#1a2a22",
    warning: "#e0b062",
    warningSurface: "#2a2115",
    error: "#ef8f84",
    errorSurface: "#2e1a18",
    focus: "#e2c89e",
    glassSurface: "rgba(24, 34, 44, 0.86)",
    glassBorder: "rgba(255, 255, 255, 0.14)",
    overlay: "rgba(2, 6, 10, 0.72)",
    skeleton: "#2a3945",
  },
  typography: { fontFamily: FONT_STACK, fontFamilyHeading: FONT_STACK, ...SHARED_TYPOGRAPHY },
  layout: SHARED_LAYOUT,
  shape: {
    ...SHARED_SHAPE,
    shadowCard: "0 1px 2px rgba(0, 0, 0, 0.4)",
    shadowOverlay: "0 18px 50px rgba(0, 0, 0, 0.5)",
  },
  control: SHARED_CONTROL,
  motion: SHARED_MOTION,
  density: SHARED_DENSITY,
  zIndex: SHARED_Z_INDEX,
};

/** تمِ پیش‌فرض — همان قالبِ «میراث کلبه» که امروز فعال است. */
export const HERITAGE_THEME: ThemeConfig = {
  id: "heritage",
  name: "میراث کلبه",
  description:
    "هویت بصریِ تأییدشده: سرمه‌ای عمیق، سطحِ گرمِ مایل به کرم و آجریِ کنترل‌شده. این مجموعه همان مقادیری است که پیش از فاز ۶.۱ روی سایت اعمال می‌شد.",
  modes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
};

export const DEFAULT_THEME: ThemeConfig = HERITAGE_THEME;

export const THEME_TOKEN_GROUPS: readonly TokenGroup[] = ["color", "typography", "layout", "shape", "control", "motion", "density", "zIndex"];

export function tokenNamesOf(group: TokenGroup): readonly string[] {
  if (group === "color") return COLOR_TOKENS;
  if (group === "typography") return TYPOGRAPHY_TOKENS;
  if (group === "layout") return LAYOUT_TOKENS;
  if (group === "shape") return SHAPE_TOKENS;
  if (group === "control") return CONTROL_TOKENS;
  if (group === "motion") return MOTION_TOKENS;
  if (group === "density") return DENSITY_TOKENS;
  return Z_INDEX_TOKENS;
}

/**
 * نگاشتِ نشانه‌های معناییِ تازه به متغیرهای قدیمی (`--kv-*`, `--site-*`).
 *
 * چرا این نگاشت وجود دارد؟ چون CSS فعلی روی `--kv-*` نوشته شده و قرار نیست در
 * فاز ۶.۱ بازنویسی شود. با این نگاشت، `storefront/designSystem.ts` می‌تواند هنگام
 * اعمالِ تم، نشانه‌های تازه را هم به‌روز کند و دو سیستم از هم جدا نمی‌افتند.
 * این نگاشت فقط مقادیر نمایشی را منتقل می‌کند و هیچ مقدارِ تازه‌ای به CSS فعلی
 * تحمیل نمی‌کند (نشانه‌های تازه هنوز مصرف‌کننده‌ای ندارند).
 */
export const LEGACY_VARIABLE_ALIASES: ReadonlyArray<{ legacy: string; token: string }> = [
  { legacy: "--kv-canvas", token: tokenVariableName("color", "background") },
  { legacy: "--kv-surface", token: tokenVariableName("color", "surface") },
  { legacy: "--kv-surface-muted", token: tokenVariableName("color", "surfaceMuted") },
  { legacy: "--kv-ink", token: tokenVariableName("color", "text") },
  { legacy: "--kv-ink-soft", token: tokenVariableName("color", "primary") },
  { legacy: "--kv-muted", token: tokenVariableName("color", "muted") },
  { legacy: "--kv-accent", token: tokenVariableName("color", "accent") },
  { legacy: "--kv-border", token: tokenVariableName("color", "border") },
  { legacy: "--kv-focus", token: tokenVariableName("color", "focus") },
  { legacy: "--kv-radius-control", token: tokenVariableName("shape", "radiusControl") },
  { legacy: "--kv-radius-surface", token: tokenVariableName("shape", "radiusSurface") },
  { legacy: "--site-bg", token: tokenVariableName("color", "background") },
  { legacy: "--site-surface", token: tokenVariableName("color", "surface") },
  { legacy: "--site-surface-muted", token: tokenVariableName("color", "surfaceMuted") },
  { legacy: "--site-text", token: tokenVariableName("color", "text") },
  { legacy: "--site-muted", token: tokenVariableName("color", "muted") },
  { legacy: "--site-primary", token: tokenVariableName("color", "primary") },
  { legacy: "--site-accent", token: tokenVariableName("color", "accent") },
  { legacy: "--site-border", token: tokenVariableName("color", "border") },
  { legacy: "--site-focus", token: tokenVariableName("color", "focus") },
];

/**
 * نشانه‌هایی که از متغیرهای قدیمی قابل استخراج نیستند ولی در CSS فعلی مقدارِ
 * ثابت دارند — اینجا فقط برای مستندسازی و هم‌ترازی نگه داشته می‌شوند تا
 * migrateکردنِ تدریجی گم نشود.
 */
export const LEGACY_LITERAL_TOKENS: Readonly<Record<string, { light: string; dark: string }>> = {
  [tokenVariableName("color", "success")]: { light: "#477154", dark: "#7fc79b" },
  [tokenVariableName("color", "warning")]: { light: "#8a631c", dark: "#e0b062" },
  [tokenVariableName("color", "error")]: { light: "#a4463d", dark: "#ef8f84" },
};
