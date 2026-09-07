export type CategoryLayout = "bento" | "editorial" | "grid" | "rail" | "split";
export type CategoryCardRatio = "portrait" | "landscape" | "square";
export type CategoryKind = "product" | "style" | "collection";

export type SiteCategory = {
  id: string;
  label: string;
  latin: string;
  image: string;
  to: string;
  kind: CategoryKind;
  badge: string;
  enabled: boolean;
  featured: boolean;
};

export type CategorySectionConfig = {
  eyebrow: string;
  title: string;
  description: string;
  layout: CategoryLayout;
  ratio: CategoryCardRatio;
  radius: "none" | "soft" | "round";
  showBadges: boolean;
  items: SiteCategory[];
};

export type ThemeTokens = {
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

export type SiteTheme = {
  id: string;
  name: string;
  description: string;
  occasion: string;
  builtIn: boolean;
  atmosphere: "clean" | "paper" | "noir" | "romantic" | "festive";
  light: ThemeTokens;
  dark: ThemeTokens;
};

export type DesignSystemConfig = {
  activeThemeId: string;
  customThemes: SiteTheme[];
  schedule: {
    enabled: boolean;
    themeId: string;
    startsAt: string;
    endsAt: string;
  };
};

export const categoryLayoutOptions: Array<{ id: CategoryLayout; label: string; description: string }> = [
  { id: "bento", label: "بنتو", description: "ترکیب کارت‌های بزرگ و کوچک" },
  { id: "editorial", label: "ادیتوریال", description: "قاب‌های بلند مجله‌ای" },
  { id: "grid", label: "گرید", description: "شبکه منظم و فروشگاهی" },
  { id: "rail", label: "ریل", description: "اسکرول افقی در موبایل" },
  { id: "split", label: "اسپلیت", description: "دو قاب شاخص و شبکه مکمل" },
];

export const defaultCategories: SiteCategory[] = [
  { id: "cat-blazer", label: "کت و بلیزر", latin: "BLAZERS", image: "/images/model-teal.jpg", to: "/shop?cat=blazer", kind: "product", badge: "محبوب", enabled: true, featured: true },
  { id: "cat-shirt", label: "پیراهن", latin: "SHIRTS", image: "/images/detail-collar.jpg", to: "/shop?cat=shirt", kind: "product", badge: "منتخب", enabled: true, featured: true },
  { id: "cat-knit", label: "بافت و پلیور", latin: "KNITWEAR", image: "/images/flat.jpg", to: "/shop?cat=knit", kind: "product", badge: "", enabled: true, featured: false },
  { id: "cat-trouser", label: "شلوار", latin: "TROUSERS", image: "/images/detail-hem.jpg", to: "/shop?cat=trouser", kind: "product", badge: "", enabled: true, featured: false },
  { id: "cat-shoes", label: "کفش", latin: "FOOTWEAR", image: "/images/model-full.jpg", to: "/shop?cat=shoes", kind: "product", badge: "جدید", enabled: true, featured: false },
  { id: "cat-accessory", label: "اکسسوری", latin: "ACCESSORIES", image: "/images/banner.jpg", to: "/shop?cat=accessory", kind: "product", badge: "", enabled: true, featured: false },
];

export const aestheticCategories: SiteCategory[] = [
  { id: "style-dark-academia", label: "دارک آکادمیا", latin: "DARK ACADEMIA", image: "/images/model-teal.jpg", to: "/shop?style=dark-academia", kind: "style", badge: "پرطرفدار", enabled: true, featured: true },
  { id: "style-vintage", label: "وینتیج کلاسیک", latin: "CLASSIC VINTAGE", image: "/images/model-front.jpg", to: "/shop?style=vintage", kind: "style", badge: "امضای کلبه", enabled: true, featured: true },
  { id: "style-old-money", label: "اولد مانی", latin: "OLD MONEY", image: "/images/model-full.jpg", to: "/shop?style=old-money", kind: "style", badge: "", enabled: true, featured: false },
  { id: "style-romantic", label: "رمانتیک", latin: "ROMANTIC", image: "/images/detail-collar.jpg", to: "/shop?style=romantic", kind: "style", badge: "فصل جدید", enabled: true, featured: false },
  { id: "style-retro", label: "رترو دهه هفتاد", latin: "SEVENTIES", image: "/images/banner.jpg", to: "/shop?style=retro", kind: "style", badge: "", enabled: true, featured: false },
  { id: "style-cottage", label: "کاتج‌کور", latin: "COTTAGECORE", image: "/images/flat.jpg", to: "/shop?style=cottagecore", kind: "style", badge: "", enabled: true, featured: false },
];

export const defaultCategorySection: CategorySectionConfig = {
  eyebrow: "CATEGORIES",
  title: "دسته‌بندی محصولات",
  description: "مسیرهای منتخب برای پیدا کردن استایل شخصی شما",
  layout: "bento",
  ratio: "landscape",
  radius: "round",
  showBadges: true,
  items: defaultCategories,
};

export const themeTemplates: SiteTheme[] = [
  {
    id: "heritage", name: "میراث کلبه", occasion: "همیشگی", builtIn: true, atmosphere: "paper",
    description: "سرمه‌ای عمیق، کاغذ گرم و آجری؛ هویت اصلی برند.",
    light: { background: "#f7f5f0", surface: "#fffdfa", surfaceMuted: "#efede7", text: "#071c31", muted: "#66727d", primary: "#0b2a46", primaryText: "#ffffff", accent: "#c9654d", border: "#d8d3ca", focus: "#547a98" },
    dark: { background: "#10161d", surface: "#18222c", surfaceMuted: "#202d38", text: "#f5f0e8", muted: "#acb8c2", primary: "#d9bd91", primaryText: "#17130e", accent: "#e07a61", border: "#354552", focus: "#e2c89e" },
  },
  {
    id: "black-friday", name: "بلک فرایدی", occasion: "فروش ویژه", builtIn: true, atmosphere: "noir",
    description: "مشکی لوکس با طلایی کنترل‌شده؛ مناسب کمپین تخفیف.",
    light: { background: "#11100e", surface: "#1c1a17", surfaceMuted: "#29251f", text: "#fffaf0", muted: "#c7bda9", primary: "#e3c35f", primaryText: "#171109", accent: "#f2d774", border: "#454034", focus: "#ffe697" },
    dark: { background: "#080808", surface: "#12110f", surfaceMuted: "#1c1a17", text: "#fffaf0", muted: "#bdb29f", primary: "#e7c85f", primaryText: "#14100a", accent: "#f3d979", border: "#373329", focus: "#ffe89a" },
  },
  {
    id: "valentine", name: "ولنتاین", occasion: "۱۴ فوریه", builtIn: true, atmosphere: "romantic",
    description: "رز چرک، کرم لطیف و شرابی؛ عاشقانه اما غیرکلیشه‌ای.",
    light: { background: "#ffe8f0", surface: "#fff7fa", surfaceMuted: "#f8cedc", text: "#481527", muted: "#85566a", primary: "#a72855", primaryText: "#ffffff", accent: "#e05283", border: "#e9b7c9", focus: "#b83261" },
    dark: { background: "#280b18", surface: "#371020", surfaceMuted: "#4a172b", text: "#fff0f5", muted: "#dda9bb", primary: "#f291b1", primaryText: "#35101d", accent: "#ff6f9f", border: "#6d2e46", focus: "#ffb0c9" },
  },
  {
    id: "nowruz", name: "نوروز", occasion: "عید نوروز", builtIn: true, atmosphere: "festive",
    description: "سبز سنجد، فیروزه‌ای و طلایی؛ روشن و بهاری.",
    light: { background: "#eaf7e6", surface: "#fbfff8", surfaceMuted: "#d5ebcf", text: "#123a28", muted: "#557563", primary: "#126348", primaryText: "#ffffff", accent: "#d49a2d", border: "#bad8b4", focus: "#197658" },
    dark: { background: "#0e2119", surface: "#152e23", surfaceMuted: "#1e3b2e", text: "#eff9f1", muted: "#a9c5b3", primary: "#78d6a6", primaryText: "#092016", accent: "#e5b65a", border: "#315743", focus: "#91e6b9" },
  },
  {
    id: "yalda", name: "شب یلدا", occasion: "کمپین یلدا", builtIn: true, atmosphere: "festive",
    description: "اناری عمیق و سبز کاج با زمینه گرم شبانه.",
    light: { background: "#f8e7e5", surface: "#fff7f2", surfaceMuted: "#edcfcc", text: "#40131d", muted: "#7d555b", primary: "#8a1734", primaryText: "#ffffff", accent: "#287051", border: "#deb5b3", focus: "#a52746" },
    dark: { background: "#17090e", surface: "#260e16", surfaceMuted: "#381421", text: "#fff2ed", muted: "#d2aaa9", primary: "#f07591", primaryText: "#2b0912", accent: "#72c59c", border: "#5e2938", focus: "#f69aae" },
  },
  {
    id: "dark-academia", name: "دارک آکادمیا", occasion: "کالکشن پاییز", builtIn: true, atmosphere: "paper",
    description: "قهوه‌ای کتابخانه، زیتونی و کاغذ کهنه.",
    light: { background: "#f3eee4", surface: "#fbf7ef", surfaceMuted: "#e6ddcd", text: "#2d251c", muted: "#706454", primary: "#493c2b", primaryText: "#ffffff", accent: "#7a5b32", border: "#d3c5b0", focus: "#5d4a31" },
    dark: { background: "#18140f", surface: "#241e17", surfaceMuted: "#30281e", text: "#f1e7d5", muted: "#b9aa92", primary: "#d3b47e", primaryText: "#21170c", accent: "#b78a4e", border: "#4a3e2e", focus: "#dfc392" },
  },
];

export const defaultDesignSystem: DesignSystemConfig = {
  activeThemeId: "heritage",
  customThemes: [],
  schedule: { enabled: false, themeId: "black-friday", startsAt: "", endsAt: "" },
};

export function resolveTheme(config: DesignSystemConfig, now = new Date()) {
  const themes = [...themeTemplates, ...config.customThemes];
  const schedule = config.schedule;
  const start = schedule.startsAt ? new Date(schedule.startsAt).getTime() : Number.NaN;
  const end = schedule.endsAt ? new Date(schedule.endsAt).getTime() : Number.NaN;
  const scheduled = schedule.enabled && Number.isFinite(start) && Number.isFinite(end) && now.getTime() >= start && now.getTime() <= end;
  const id = scheduled ? schedule.themeId : config.activeThemeId;
  return themes.find((theme) => theme.id === id) ?? themeTemplates[0];
}

export function applyDesignSystem(config: DesignSystemConfig, mode: "light" | "dark") {
  if (typeof document === "undefined") return;
  const theme = resolveTheme(config);
  const tokens = theme[mode];
  const root = document.documentElement;
  const variables: Record<string, string> = {
    "--site-bg": tokens.background,
    "--site-surface": tokens.surface,
    "--site-surface-muted": tokens.surfaceMuted,
    "--site-text": tokens.text,
    "--site-muted": tokens.muted,
    "--site-primary": tokens.primary,
    "--site-primary-text": tokens.primaryText,
    "--site-accent": tokens.accent,
    "--site-border": tokens.border,
    "--site-focus": tokens.focus,
    "--kv-canvas": tokens.background,
    "--kv-surface": tokens.surface,
    "--kv-surface-muted": tokens.surfaceMuted,
    "--kv-ink": tokens.text,
    "--kv-ink-soft": tokens.primary,
    "--kv-muted": tokens.muted,
    "--kv-accent": tokens.accent,
    "--kv-border": tokens.border,
    "--kv-focus": tokens.focus,
  };
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  root.dataset.siteTheme = theme.id;
  root.dataset.atmosphere = theme.atmosphere;
}

function luminance(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return 0;
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastRatio(foreground: string, background: string) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
