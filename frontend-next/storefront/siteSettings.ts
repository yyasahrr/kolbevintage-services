import { useSyncExternalStore } from "react";
import { footerColumnsFa, mainNav, type NavItem } from "./siteData";
import {
  defaultCategorySection,
  defaultDesignSystem,
  type CategorySectionConfig,
  type DesignSystemConfig,
} from "./designSystem";
import { api, loadToken } from "./lib/api";

export type HeroTemplate = "cover" | "split" | "mosaic" | "duo" | "minimal";

/** پیکربندی استودیوی هیرو - تمپلیت + پسزمینه دلخواه + شمارنده جشنواره */
export type HeroStudioConfig = {
  published: boolean;
  template: 1 | 2 | 3 | 4 | 5 | 6;
  bgImage: string;
  overlay: number;
  imageShape: "rect" | "rounded" | "circle";
  dark: boolean;
  video1: string;
  video2: string;
  video3: string;
  heroVideo: string;
  videoPoster: string;
  titleColor: string;
  subtitleColor: string;
  buttonHoverBg: string;
  buttonHoverText: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaTo: string;
  countdown: {
    enabled: boolean;
    label: string;
    target: string;
    style: "glass" | "dark" | "light" | "solid";
    bgColor: string;
    bgImage: string;
    accent: string;
  };
};

export const defaultHeroStudio: HeroStudioConfig = {
  published: false,
  template: 5,
  bgImage: "/images/model-front.jpg",
  overlay: 0.45,
  imageShape: "rect",
  dark: false,
  video1: "/videos/hero-1.mp4",
  video2: "/videos/hero-2.mp4",
  video3: "/videos/hero-3.mp4",
  heroVideo: "/videos/hero-2.mp4",
  videoPoster: "/images/model-full.jpg",
  titleColor: "",
  subtitleColor: "",
  buttonHoverBg: "#0a2c55",
  buttonHoverText: "#ffffff",
  eyebrow: "جشنواره فروش فوق‌العاده کلبه",
  title: "کالکشن وینتیج، با تخفیف استثنایی",
  subtitle: "چند روز بیشتر نمانده؛ قطعات منتخب پاییزی با قیمت جشنواره.",
  ctaLabel: "مشاهده پیشنهادها",
  ctaTo: "/shop",
  countdown: {
    enabled: true,
    label: "پایان جشنواره",
    target: "",
    style: "glass",
    bgColor: "",
    bgImage: "",
    accent: "#c9654d",
  },
};


/* --------------------------------- سایتساز --------------------------------- */

export type BuilderStyleCard = { id: string; name: string; latin: string; img: string; tagline: string; count?: string };
export type BuilderPost = {
  slug: string; title: string; excerpt: string; body: string; cover: string;
  date: string; category: string; readTime: string; pinned?: boolean;
};
export type BuilderInstaCard = { id: string; icon: string; title: string; text: string; img?: string };
export type BuilderHotspot = { id: string; x: number; y: number; label: string; color: string; visible: boolean };
export type BuilderLookProduct = { id: string; name: string; price: number; img: string; to: string };
export type HomepageSectionType = "hero" | "categories" | "new-arrivals" | "banner" | "best-sellers" | "style-look" | "trust";
export type HomepageMode = "store" | "festival" | "landing" | "collection";
export type InstallmentComponent = {
  enabled: boolean;
  provider: "snappay" | "digipay" | "both";
  markupPercent: number;
  installments: number;
  label: string;
  showOnCard: boolean;
  showOnProduct: boolean;
};

/** کامپوننت شمارنده جشنواره — قابل نصب روی هیرو و هر بنر سایت */
export type CountdownComponent = {
  enabled: boolean;
  label: string;
  target: string;
  style: "glass" | "dark" | "light" | "solid";
  accent: string;
  bgColor: string;
  bgImage: string;
  size: "sm" | "md" | "lg";
  placement: {
    hero: boolean;
    featureBanner: boolean;
    midBanner: boolean;
    bottomWholesale: boolean;
    bottomStyles: boolean;
  };
  position: "top" | "center" | "bottom";
  align: "right" | "center" | "left";
};

export type SiteBuilder = {
  homepage: {
    mode: HomepageMode;
    template: "commerce" | "campaign" | "editorial" | "collection-focus";
    sections: Array<{ id: string; type: HomepageSectionType; enabled: boolean }>;
  };
  campaign: {
    enabled: boolean;
    id: string;
    name: string;
    discountPercent: number;
    targetType: "all" | "category" | "collection" | "product";
    targetValue: string;
    startsAt: string;
    endsAt: string;
    couponCode: string;
  };
  typography: {
    siteFont: string;
    headingFont: string;
    promotionalFont: string;
    customFonts: Array<{ id: string; name: string; url: string; format: "woff2" | "woff" | "ttf" }>;
  };
  productCard: {
    hoverBg: string; hoverText: string;
    radius: "none" | "soft" | "round";
    imageRatio: "portrait" | "square" | "landscape";
    contentAlign: "right" | "center";
    showSubtitle: boolean; showColors: boolean; showCompare: boolean; showQuickAdd: boolean; showInstallment: boolean;
  };
  banner: {
    mode: "single" | "split" | "grid3";
    mediaType: "image" | "video";
    media: string;
    poster: string;
    overlay: number;
    height: "sm" | "md" | "lg";
    contentAlign: "right" | "center" | "left";
    fontFamily: string;
    titleSize: number;
    radius: "none" | "soft" | "round";
    eyebrow: string; title: string; description: string;
    buttonLabel: string; buttonTo: string;
    buttonBg: string; buttonText: string; buttonHoverBg: string; buttonHoverText: string;
    tile2: string; tile3: string;
  };
  stylesSection: {
    fullBleed: boolean; cards: BuilderStyleCard[];
    columns: 2 | 3 | 4;
    imageRatio: "portrait" | "square" | "landscape";
    overlay: number;
    radius: "none" | "soft" | "round";
    textAlign: "right" | "center";
  };
  popup: {
    enabled: boolean; delaySec: number; oncePerSession: boolean;
    direction: "rtl" | "ltr"; position: "center" | "bottom-right" | "bottom-left";
    bg: string; bgImage: string; textColor: string; accent: string;
    title: string; body: string; inputPlaceholder: string; ctaLabel: string;
    couponCode: string; image: string;
    width: "sm" | "md" | "lg";
    layout: "image-right" | "image-left" | "background";
    radius: "none" | "soft" | "round";
  };
  look: {
    enabled: boolean;
    image: string;
    title: string;
    subtitle: string;
    products: BuilderLookProduct[];
    hotspots: BuilderHotspot[];
    compact: boolean;
    autoSuggest: boolean;
    anchorProductId: string;
    strategy: "visual" | "catalog" | "behavior" | "hybrid";
  };
  blog: { homeGrid: "2col" | "3col" | "list"; homeCount: number; posts: BuilderPost[] };
  instagram: {
    enabled: boolean; username: string;
    cards: BuilderInstaCard[];
    cta: { enabled: boolean; title: string; text: string; buttonLabel: string; buttonTo: string; bg: string };
  };
  footer: {
    newsletterEnabled: boolean;
    socials: Array<{ icon: string; label: string; url: string }>;
  };
  components: {
    countdown: CountdownComponent;
    installment: InstallmentComponent;
    freeShipping: { enabled: boolean; threshold: number; label: string; showOnCard: boolean };
    stockUrgency: { enabled: boolean; threshold: number; label: string };
  };
};

export const defaultSiteBuilder: SiteBuilder = {
  homepage: {
    mode: "store",
    template: "commerce",
    sections: [
      { id: "home-hero", type: "hero", enabled: true },
      { id: "home-categories", type: "categories", enabled: true },
      { id: "home-new", type: "new-arrivals", enabled: true },
      { id: "home-banner", type: "banner", enabled: true },
      { id: "home-best", type: "best-sellers", enabled: true },
      { id: "home-look", type: "style-look", enabled: true },
      { id: "home-trust", type: "trust", enabled: true },
    ],
  },
  campaign: { enabled: false, id: "", name: "", discountPercent: 0, targetType: "all", targetValue: "", startsAt: "", endsAt: "", couponCode: "" },
  typography: { siteFont: "inherit", headingFont: "inherit", promotionalFont: "inherit", customFonts: [] },
  productCard: {
    hoverBg: "#011c3a", hoverText: "#ffffff", radius: "soft", imageRatio: "portrait", contentAlign: "right",
    showSubtitle: true, showColors: true, showCompare: true, showQuickAdd: true, showInstallment: true,
  },
  banner: {
    mode: "single",
    mediaType: "image",
    media: "/images/banner.jpg",
    poster: "/images/model-full.jpg",
    overlay: 0.35,
    height: "md",
    contentAlign: "center",
    fontFamily: "inherit",
    titleSize: 40,
    radius: "none",
    eyebrow: "AUTUMN COLLECTION",
    title: "پاییز، فصل پارچه‌های سنگین",
    description: "پشم شورون، بافت کابلی و کشمیر. کالکشنی که برای سردترین روزهای سال دوخته شده است.",
    buttonLabel: "کاوش در کالکشن",
    buttonTo: "/collection",
    buttonBg: "#ffffff",
    buttonText: "#011c3a",
    buttonHoverBg: "#011c3a",
    buttonHoverText: "#ffffff",
    tile2: "/images/model-teal.jpg",
    tile3: "/images/detail-hem.jpg",
  },
  stylesSection: { fullBleed: false, cards: [], columns: 4, imageRatio: "landscape", overlay: 0.65, radius: "none", textAlign: "right" },
  popup: {
    enabled: true,
    delaySec: 20,
    oncePerSession: true,
    direction: "rtl",
    position: "center",
    bg: "#ffffff",
    bgImage: "",
    textColor: "#011c3a",
    accent: "#c9654d",
    title: "به کلبه وینتیج خوش آمدید",
    body: "برای دریافت ۱۰٪ تخفیف اولین خرید، ایمیل خود را وارد کنید.",
    inputPlaceholder: "ایمیل شما",
    ctaLabel: "دریافت کد تخفیف",
    couponCode: "KOLBE10",
    image: "/images/detail-collar.jpg",
    width: "md",
    layout: "image-right",
    radius: "soft",
  },
  look: {
    enabled: true,
    image: "/images/model-teal.jpg",
    title: "عصر پاییزی در کتابخانه",
    subtitle: "پیشنهاد استایلیست‌های کلبه برای تکمیل این ست — شلوار، کفش و قطعات مکمل.",
    products: [
      { id: "lp-1", name: "پلیور بافت کابلی", price: 3180000, img: "/images/flat.jpg", to: "/shop" },
      { id: "lp-2", name: "شلوار پیلی‌دار کلاسیک", price: 2950000, img: "/images/detail-hem.jpg", to: "/shop" },
      { id: "lp-3", name: "شال گردن پشمی", price: 890000, img: "/images/detail-collar.jpg", to: "/shop" },
    ],
    hotspots: [
      { id: "h1", x: 30, y: 40, label: "شلوار پلیسه", color: "#c9654d", visible: true },
      { id: "h2", x: 70, y: 65, label: "کفش چرم", color: "#c9654d", visible: true },
    ],
    compact: true,
    autoSuggest: true,
    anchorProductId: "",
    strategy: "hybrid",
  },
  blog: {
    homeGrid: "3col",
    homeCount: 3,
    posts: [],
  },
  instagram: {
    enabled: true,
    username: "kolbe.vintage",
    cards: [
      { id: "i1", icon: "star", title: "امتحان مجازی", text: "پرو هوشمند با KOLBE AI" },
      { id: "i2", icon: "needle", title: "دوخت دست", text: "تولید محدود در کارگاه کلبه" },
      { id: "i3", icon: "truck", title: "ارسال سریع", text: "به سراسر ایران" },
    ],
    cta: { enabled: true, title: "اینستاگرام کلبه", text: "استایل‌های روزانه و پشت صحنه کارگاه", buttonLabel: "دنبال کنید", buttonTo: "https://instagram.com/kolbe.vintage", bg: "#011c3a" },
  },
  footer: {
    newsletterEnabled: false,
    socials: [
      { icon: "mail", label: "اینستاگرام", url: "https://instagram.com/kolbe.vintage" },
      { icon: "phone", label: "تلفن پشتیبانی", url: "tel:+982191002233" },
      { icon: "mail", label: "تلگرام", url: "https://t.me/kolbevintage" },
    ],
  },
  components: {
    countdown: {
      enabled: false,
      label: "پایان جشنواره",
      target: "",
      style: "glass",
      accent: "#c9654d",
      bgColor: "",
      bgImage: "",
      size: "md",
      placement: { hero: true, featureBanner: false, midBanner: false, bottomWholesale: false, bottomStyles: false },
      position: "bottom",
      align: "center",
    },
    installment: {
      enabled: true, provider: "snappay", markupPercent: 4, installments: 4,
      label: "پرداخت اقساطی بدون چک", showOnCard: true, showOnProduct: true,
    },
    freeShipping: { enabled: true, threshold: 5_000_000, label: "ارسال رایگان", showOnCard: false },
    stockUrgency: { enabled: true, threshold: 3, label: "تنها چند عدد باقی مانده" },
  },
};

export type SiteSettings = {
  categories: CategorySectionConfig;
  designSystem: DesignSystemConfig;
  header: {
    brand: string;
    latinBrand: string;
    shopLabel: string;
    nav: NavItem[];
    videoHeroTextColor: string;
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    height: number;
    sticky: boolean;
    showNavigation: boolean;
    showThemeToggle: boolean;
    showSearch: boolean;
    showAccount: boolean;
    showWishlist: boolean;
  };
  heroStudio: HeroStudioConfig;
  builder: SiteBuilder;
  hero: {
    template: HeroTemplate;
    eyebrow: string;
    title: string;
    description: string;
    primaryLabel: string;
    primaryTo: string;
    secondaryLabel: string;
    secondaryTo: string;
    images: string[];
  };
  collectionBanner: {
    mediaType: "image" | "video";
    mediaUrl: string;
    posterUrl: string;
    eyebrow: string;
    title: string;
    description: string;
    buttonLabel: string;
    buttonTo: string;
  };
  footer: {
    title: string;
    description: string;
    emailPlaceholder: string;
    columns: { title: string; items: string[] }[];
    address: string;
    phone: string;
    hours: string;
    email: string;
    columnUrls: string[][];
    copyright: string;
    appearance: {
      layout: "columns" | "compact";
      template: "editorial" | "minimal" | "commerce" | "centered";
      showBrand: boolean;
      showContact: boolean;
      showLicenses: boolean;
      mobileAccordion: boolean;
      backgroundColor: string;
      textColor: string;
    };
  };
};

export const defaultSiteSettings: SiteSettings = {
  categories: defaultCategorySection,
  designSystem: defaultDesignSystem,
  header: {
    brand: "کلبه وینتیج",
    latinBrand: "KOLBE VINTAGE",
    shopLabel: "فروشگاه",
    videoHeroTextColor: "#ffffff",
    backgroundColor: "#fffdfa",
    textColor: "#071c31",
    borderColor: "#d8d3ca",
    height: 66,
    sticky: true,
    showNavigation: true,
    showThemeToggle: true,
    showSearch: true,
    showAccount: true,
    showWishlist: true,
    nav: [
      { label: "صفحه اصلی", to: "/" },
      { label: "فروشگاه", to: "/shop" },
      { label: "خرید عمده", to: "/wholesale" },
      { label: "مجله", to: "/blog" },
      { label: "پشتیبانی", to: "/contact" },
    ],
  },
  heroStudio: defaultHeroStudio,
  builder: defaultSiteBuilder,
  hero: {
    template: "cover",
    eyebrow: "کالکشن پاییز ۱۴۰۵",
    title: "لباسی که با گذر زمان زیباتر می‌شود",
    description: "پارچه‌های نجیب، برش‌های کلاسیک و دوخت دست؛ قطعاتی که یک عمر همراه شما می‌مانند.",
    primaryLabel: "مشاهده کالکشن",
    primaryTo: "/collection",
    secondaryLabel: "پرو هوشمند با KOLBE AI",
    secondaryTo: "/try-on",
    images: ["/images/model-front.jpg", "/images/model-teal.jpg", "/images/detail-collar.jpg", "/images/model-full.jpg"],
  },
  collectionBanner: {
    mediaType: "image",
    mediaUrl: "/images/banner.jpg",
    posterUrl: "/images/banner.jpg",
    eyebrow: "AUTUMN COLLECTION",
    title: "پاییز، فصل پارچه‌های سنگین",
    description: "پشم شورون، بافت کابلی و کشمیر. کالکشنی که برای سردترین روزهای سال دوخته شده است.",
    buttonLabel: "کاوش در کالکشن",
    buttonTo: "/collection",
  },
  footer: {
    title: "به دنیای کلبه وینتیج بپیوندید",
    description: "اولین نفری باشید که از کالکشن‌های جدید، رویدادها و پیشنهادهای ویژه باخبر می‌شود.",
    emailPlaceholder: "نشانی ایمیل خود را وارد کنید",
    columns: footerColumnsFa.slice(0, 3).map((column) => ({ title: column.title, items: column.items.slice(0, 4) })),
    address: "تهران، خیابان ولیعصر، پلاک ۱۲۴۰",
    phone: "۰۲۱-۹۱۰۰۲۲۳۳",
    hours: "شنبه تا پنجشنبه، ۱۰ تا ۱۹",
    email: "hi@kolbevintage.ir",
    columnUrls: [
      ["/shop?sort=new", "/collection", "/shop?cat=blazer", "/shop?cat=shirt"],
      ["/about", "/contact", "/contact", "/about"],
      ["/account", "/wishlist", "/compare", "/try-on"],
    ],
    copyright: "© کلبه وینتیج ۱۴۰۵ — تمامی حقوق محفوظ است",
    appearance: {
      layout: "columns",
      template: "editorial",
      showBrand: true,
      showContact: true,
      showLicenses: true,
      mobileAccordion: true,
      backgroundColor: "#f2f0eb",
      textColor: "#011c3a",
    },
  },
};

const STORAGE_KEY = "kolbe-site-content-v3";
const EVENT_NAME = "kolbe-site-content-change";
const EMBEDDED_HERO_VIDEO_URL = "/store/kolbe/site/hero-video";
const EMBEDDED_BANNER_VIDEO_URL = "/store/kolbe/site/banner-video";
let cacheRaw = "";
let cacheValue = defaultSiteSettings;
let remoteSaveTimer: ReturnType<typeof setTimeout> | undefined;

function isEmbeddedHeroVideo(value: unknown): value is string {
  return typeof value === "string" && /^data:video\//i.test(value);
}

/** ویدیوهای Base64 نباید داخل localStorage بمانند؛ باعث قفل شدن شروع صفحه می‌شوند. */
function settingsForBrowserStorage(settings: SiteSettings): SiteSettings {
  let safeSettings = settings;
  if (isEmbeddedHeroVideo(settings.heroStudio.heroVideo)) safeSettings = {
    ...settings,
    heroStudio: { ...settings.heroStudio, heroVideo: EMBEDDED_HERO_VIDEO_URL },
  };
  if (safeSettings.builder.banner.mediaType === "video" && isEmbeddedHeroVideo(safeSettings.builder.banner.media)) safeSettings = {
    ...safeSettings,
    builder: { ...safeSettings.builder, banner: { ...safeSettings.builder.banner, media: EMBEDDED_BANNER_VIDEO_URL } },
  };
  return safeSettings;
}

function mergeSiteSettings(saved: Partial<SiteSettings>): SiteSettings {
  return {
    ...defaultSiteSettings,
    ...saved,
    categories: {
      ...defaultCategorySection,
      ...(saved.categories ?? {}),
      items: saved.categories?.items ?? defaultCategorySection.items,
    },
    designSystem: {
      ...defaultDesignSystem,
      ...(saved.designSystem ?? {}),
      customThemes: saved.designSystem?.customThemes ?? defaultDesignSystem.customThemes,
      schedule: { ...defaultDesignSystem.schedule, ...(saved.designSystem?.schedule ?? {}) },
    },
    header: { ...defaultSiteSettings.header, ...saved.header },
    heroStudio: { ...defaultHeroStudio, ...(saved.heroStudio ?? {}), countdown: { ...defaultHeroStudio.countdown, ...(saved.heroStudio?.countdown ?? {}) } },
    builder: {
      ...defaultSiteBuilder,
      ...(saved.builder ?? {}),
      homepage: {
        ...defaultSiteBuilder.homepage,
        ...(saved.builder?.homepage ?? {}),
        sections: saved.builder?.homepage?.sections ?? defaultSiteBuilder.homepage.sections,
      },
      campaign: { ...defaultSiteBuilder.campaign, ...(saved.builder?.campaign ?? {}) },
      typography: {
        ...defaultSiteBuilder.typography,
        ...(saved.builder?.typography ?? {}),
        customFonts: saved.builder?.typography?.customFonts ?? defaultSiteBuilder.typography.customFonts,
      },
      productCard: { ...defaultSiteBuilder.productCard, ...(saved.builder?.productCard ?? {}) },
      banner: { ...defaultSiteBuilder.banner, ...(saved.builder?.banner ?? {}) },
      stylesSection: {
        ...defaultSiteBuilder.stylesSection,
        ...(saved.builder?.stylesSection ?? {}),
        cards: saved.builder?.stylesSection?.cards ?? defaultSiteBuilder.stylesSection.cards,
      },
      popup: { ...defaultSiteBuilder.popup, ...(saved.builder?.popup ?? {}) },
      look: {
        ...defaultSiteBuilder.look,
        ...(saved.builder?.look ?? {}),
        products: saved.builder?.look?.products ?? defaultSiteBuilder.look.products,
        hotspots: saved.builder?.look?.hotspots ?? defaultSiteBuilder.look.hotspots,
      },
      blog: { ...defaultSiteBuilder.blog, ...(saved.builder?.blog ?? {}) },
      instagram: {
        ...defaultSiteBuilder.instagram,
        ...(saved.builder?.instagram ?? {}),
        cards: saved.builder?.instagram?.cards ?? defaultSiteBuilder.instagram.cards,
        cta: { ...defaultSiteBuilder.instagram.cta, ...(saved.builder?.instagram?.cta ?? {}) },
      },
      footer: { ...defaultSiteBuilder.footer, ...(saved.builder?.footer ?? {}) },
      components: {
        countdown: {
          ...defaultSiteBuilder.components.countdown,
          ...(saved.builder?.components?.countdown ?? {}),
          placement: { ...defaultSiteBuilder.components.countdown.placement, ...(saved.builder?.components?.countdown?.placement ?? {}) },
        },
        installment: { ...defaultSiteBuilder.components.installment, ...(saved.builder?.components?.installment ?? {}) },
        freeShipping: { ...defaultSiteBuilder.components.freeShipping, ...(saved.builder?.components?.freeShipping ?? {}) },
        stockUrgency: { ...defaultSiteBuilder.components.stockUrgency, ...(saved.builder?.components?.stockUrgency ?? {}) },
      },
    },
    hero: { ...defaultSiteSettings.hero, ...saved.hero },
    collectionBanner: { ...defaultSiteSettings.collectionBanner, ...saved.collectionBanner },
    footer: {
      ...defaultSiteSettings.footer,
      ...saved.footer,
      columnUrls: saved.footer?.columnUrls ?? defaultSiteSettings.footer.columnUrls,
      appearance: { ...defaultSiteSettings.footer.appearance, ...(saved.footer?.appearance ?? {}) },
    },
  };
}

export function loadSiteSettings(): SiteSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    if (!raw) return defaultSiteSettings;
    if (raw === cacheRaw) return cacheValue;
    const saved = JSON.parse(raw) as Partial<SiteSettings>;
    cacheValue = settingsForBrowserStorage(mergeSiteSettings(saved));
    cacheRaw = JSON.stringify(cacheValue);
    if (cacheRaw !== raw) localStorage.setItem(STORAGE_KEY, cacheRaw);
    return cacheValue;
  } catch {
    return defaultSiteSettings;
  }
}

export function saveSiteSettings(settings: SiteSettings) {
  const browserSettings = settingsForBrowserStorage(settings);
  const raw = JSON.stringify(browserSettings);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // ذخیره سرور و حافظه ادامه پیدا می‌کند؛ پر بودن storage نباید صفحه را متوقف کند.
  }
  cacheRaw = raw;
  cacheValue = browserSettings;
  window.dispatchEvent(new Event(EVENT_NAME));
  const token = loadToken("admin");
  if (token) {
    if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(() => {
      void api("/store/kolbe/admin/site-settings", { method: "PUT", token, body: { settings } }).catch(() => undefined);
    }, 450);
  }
}

/** دریافت نسخه مرکزی تنظیمات؛ روی هر بار ورود بازدیدکننده اجرا می‌شود. */
export async function syncSiteSettingsFromServer() {
  try {
    const result = await api<{ settings: Partial<SiteSettings> | null }>("/store/kolbe/site/settings");
    if (!result.settings) return;
    const settings = settingsForBrowserStorage(mergeSiteSettings(result.settings));
    const raw = JSON.stringify(settings);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // نبود فضای localStorage نباید مانع نمایش فروشگاه شود.
    }
    cacheRaw = raw;
    cacheValue = settings;
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    /* در قطعی شبکه، آخرین نسخه محلی بدون اختلال استفاده می‌شود. */
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useSiteSettings() {
  return useSyncExternalStore(subscribe, loadSiteSettings, () => defaultSiteSettings);
}
