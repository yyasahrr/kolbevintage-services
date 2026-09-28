/**
 * واریانت‌های صفحهٔ اصلی — «گالری قاب‌دار»، «ادیتوریال»، «بوتیک بنتو».
 *
 * سه حس متفاوت از یک رسیپی («کرِم و بلوط»)، تا انتخاب با چشم انجام شود.
 * مقدار انتخابی در localStorage می‌ماند و از طریق همان الگوی theme.ts منتشر می‌شود.
 */
import { useSyncExternalStore } from "react";

export type HomeVariant = "gallery" | "editorial" | "boutique";

export const HOME_VARIANT_KEY = "kolbe-home-variant-v1";
const EVENT = "kolbe-home-variant-change";

export type VariantSpec = {
  id: HomeVariant;
  name: string;
  summary: string;
  /** ریتم عمودی بخش‌ها */
  rhythm: string;
  /** عرض محتوای اصلی */
  width: string;
  /** چیدمان گرید محصولات */
  productGrid: string;
  /** چیدمان گرید دسته‌بندی‌ها */
  categoryGrid: string;
  /** کلاس قاب دور بخش‌های شاخص */
  frame: string;
};

export const homeVariants: Record<HomeVariant, VariantSpec> = {
  gallery: {
    id: "gallery",
    name: "گالری قاب‌دار",
    summary: "قاب ثابت دور محتوا، گرید ماژولار آرام، فاصله‌های سخاوتمندانه",
    rhythm: "py-16 lg:py-28",
    width: "max-w-[1320px]",
    productGrid: "grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-6",
    categoryGrid: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5",
    frame: "kv-frame",
  },
  editorial: {
    id: "editorial",
    name: "ادیتوریال",
    summary: "قاب‌های بلند مجله‌ای، ستون باریک‌تر، تیترهای بزرگ‌تر",
    rhythm: "py-20 lg:py-32",
    width: "max-w-[1160px]",
    productGrid: "grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-8",
    categoryGrid: "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6",
    frame: "",
  },
  boutique: {
    id: "boutique",
    name: "بوتیک بنتو",
    summary: "کارت‌های درهم‌بافته، چگالی بیشتر، حس ویترین فروشگاه",
    rhythm: "py-12 lg:py-20",
    width: "max-w-[1400px]",
    productGrid: "grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-4",
    categoryGrid: "grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:auto-rows-[150px] lg:gap-3",
    frame: "kv-frame",
  },
};

function read(): HomeVariant {
  if (typeof window === "undefined") return "gallery";
  try {
    const stored = window.localStorage.getItem(HOME_VARIANT_KEY);
    return stored === "editorial" || stored === "boutique" ? stored : "gallery";
  } catch {
    return "gallery";
  }
}

let cached: HomeVariant = typeof window === "undefined" ? "gallery" : read();

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

export function setHomeVariant(variant: HomeVariant) {
  cached = variant;
  try {
    window.localStorage.setItem(HOME_VARIANT_KEY, variant);
  } catch {
    // انتخاب برای همین نشست معتبر می‌ماند حتی وقتی storage در دسترس نیست.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useHomeVariant(): VariantSpec {
  const variant = useSyncExternalStore(subscribe, () => cached, () => "gallery" as HomeVariant);
  return homeVariants[variant];
}
