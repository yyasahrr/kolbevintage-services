/**
 * ماتریسِ viewport برای دروازه‌های بصریِ مراحل بعد (فاز ۶.۱-K).
 *
 * این فایل فقط داده است و هیچ ابزار مرورگری نصب نمی‌کند؛ هدف این است که
 * فازهای ۶.۲ به بعد هنگام افزودنِ Playwright/اسکرین‌شات، دقیقاً همین فهرست را
 * مصرف کنند و هر کامپوننت بر اساسِ «کلاسِ viewport» تست شود، نه عددهای پراکنده.
 */

export type ViewportTier = "mobile" | "tablet" | "desktop" | "wide";

export type Viewport = {
  id: string;
  width: number;
  height: number;
  tier: ViewportTier;
};

export const RESPONSIVE_VIEWPORT_MATRIX: readonly Viewport[] = [
  { id: "320x568", width: 320, height: 568, tier: "mobile" },
  { id: "360x800", width: 360, height: 800, tier: "mobile" },
  { id: "390x844", width: 390, height: 844, tier: "mobile" },
  { id: "430x932", width: 430, height: 932, tier: "mobile" },
  { id: "768x1024", width: 768, height: 1024, tier: "tablet" },
  { id: "820x1180", width: 820, height: 1180, tier: "tablet" },
  { id: "1024x768", width: 1024, height: 768, tier: "desktop" },
  { id: "1280x720", width: 1280, height: 720, tier: "desktop" },
  { id: "1366x768", width: 1366, height: 768, tier: "desktop" },
  { id: "1440x900", width: 1440, height: 900, tier: "desktop" },
  { id: "1920x1080", width: 1920, height: 1080, tier: "desktop" },
  { id: "2560x1440", width: 2560, height: 1440, tier: "wide" },
];

export const VIEWPORT_TIERS: readonly ViewportTier[] = ["mobile", "tablet", "desktop", "wide"];

export function tierForWidth(width: number): ViewportTier {
  if (width >= 2560) return "wide";
  if (width >= 1024) return "desktop";
  if (width >= 768) return "tablet";
  return "mobile";
}

export function viewportsForTier(tier: ViewportTier): readonly Viewport[] {
  return RESPONSIVE_VIEWPORT_MATRIX.filter((viewport) => viewport.tier === tier);
}
