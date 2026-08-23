import { useSyncExternalStore } from "react";
import { footerColumnsFa, mainNav, type NavItem } from "./siteData";

export type HeroTemplate = "cover" | "split" | "mosaic" | "duo" | "minimal";

export type SiteSettings = {
  header: { brand: string; latinBrand: string; shopLabel: string; nav: NavItem[] };
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
    nav: mainNav.filter((item) => ["جدیدترین‌ها", "کالکشن پاییز", "استایل‌ها", "مجله"].includes(item.label)),
  },
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

const STORAGE_KEY = "kolbe-site-content-v2";
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
