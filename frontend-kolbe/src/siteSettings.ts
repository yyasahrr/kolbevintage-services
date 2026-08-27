import { useSyncExternalStore } from "react";
import { footerColumnsFa, mainNav, type NavItem } from "./siteData";

export type HeroTemplate = "cover" | "split" | "mosaic" | "duo" | "minimal";

/** پیکربندی استودیوی هیرو - تمپلیت + پسزمینه دلخواه + شمارنده جشنواره */
export type HeroStudioConfig = {
  published: boolean;
  template: 1 | 2 | 3 | 4 | 5;
  bgImage: string;
  overlay: number;
  imageShape: "rect" | "rounded" | "circle";
  dark: boolean;
  video1: string;
  video2: string;
  video3: string;
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

export type SiteBuilder = {
  productCard: { hoverBg: string; hoverText: string };
  banner: {
    mode: "single" | "split" | "grid3";
    mediaType: "image" | "video";
    media: string;
    overlay: number;
    eyebrow: string; title: string; description: string;
    buttonLabel: string; buttonTo: string;
    buttonBg: string; buttonText: string; buttonHoverBg: string; buttonHoverText: string;
    tile2: string; tile3: string;
  };
  stylesSection: { fullBleed: boolean; cards: BuilderStyleCard[] };
  popup: {
    enabled: boolean; delaySec: number; oncePerSession: boolean;
    direction: "rtl" | "ltr"; position: "center" | "bottom-right" | "bottom-left";
    bg: string; bgImage: string; textColor: string; accent: string;
    title: string; body: string; inputPlaceholder: string; ctaLabel: string;
    couponCode: string; image: string;
  };
  look: {
    enabled: boolean;
    image: string;
    title: string;
    subtitle: string;
    products: BuilderLookProduct[];
    hotspots: BuilderHotspot[];
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
};

export const defaultSiteBuilder: SiteBuilder = {
  productCard: { hoverBg: "#011c3a", hoverText: "#ffffff" },
  banner: {
    mode: "single",
    mediaType: "image",
    media: "/images/banner.jpg",
    overlay: 0.35,
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
  stylesSection: { fullBleed: false, cards: [] },
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
    newsletterEnabled: true,
    socials: [
      { icon: "mail", label: "اینستاگرام", url: "https://instagram.com/kolbe.vintage" },
      { icon: "phone", label: "تلفن پشتیبانی", url: "tel:+982191002233" },
      { icon: "mail", label: "تلگرام", url: "https://t.me/kolbevintage" },
    ],
  },
};

export type SiteSettings = {
  header: { brand: string; latinBrand: string; shopLabel: string; nav: NavItem[] };
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
  };
};

export const defaultSiteSettings: SiteSettings = {
  header: {
    brand: "کلبه وینتیج",
    latinBrand: "KOLBE VINTAGE",
    shopLabel: "فروشگاه",
    nav: [
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
  },
};

const STORAGE_KEY = "kolbe-site-content-v3";
const EVENT_NAME = "kolbe-site-content-change";
let cacheRaw = "";
let cacheValue = defaultSiteSettings;

export function loadSiteSettings(): SiteSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    if (!raw) return defaultSiteSettings;
    if (raw === cacheRaw) return cacheValue;
    const saved = JSON.parse(raw) as Partial<SiteSettings>;
    cacheRaw = raw;
    cacheValue = {
      ...defaultSiteSettings,
      ...saved,
      header: { ...defaultSiteSettings.header, ...saved.header },
      heroStudio: { ...defaultHeroStudio, ...(saved.heroStudio ?? {}), countdown: { ...defaultHeroStudio.countdown, ...(saved.heroStudio?.countdown ?? {}) } },
      builder: { ...defaultSiteBuilder, ...(saved.builder ?? {}) },
      hero: { ...defaultSiteSettings.hero, ...saved.hero },
      collectionBanner: { ...defaultSiteSettings.collectionBanner, ...saved.collectionBanner },
      footer: { ...defaultSiteSettings.footer, ...saved.footer },
    };
    return cacheValue;
  } catch {
    return defaultSiteSettings;
  }
}

export function saveSiteSettings(settings: SiteSettings) {
  const raw = JSON.stringify(settings);
  localStorage.setItem(STORAGE_KEY, raw);
  cacheRaw = raw;
  cacheValue = settings;
  window.dispatchEvent(new Event(EVENT_NAME));
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
