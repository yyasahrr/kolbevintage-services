/**
 * حالت پیشنمایش موقت پنلها.
 * تا رفع کامل مشکل اتصال مرورگر به بک‌اند، ورود پنل ادمین و VIP دور زده میشود
 * تا بتوان رابط کاربری پنلها را بازدید کرد.
 * برای غیرفعالکردن: مقدار را false کنید.
 */
export const PANELS_PREVIEW_MODE = false;

/** عضویت نمایشی VIP برای حالت پیشنمایش. */
export const DEMO_VIP_MEMBERSHIP = {
  id: "demo-vip-account",
  memberName: "کاربر نمایشی",
  storeName: "بوتیک نمایشی تهران",
  phone: "۰۹۱۲۱۱۱۱۱۱۱",
  city: "تهران",
  planName: "وی‌آی‌پی (نمایشی)",
  activatedAt: new Date().toISOString(),
  expiresAt: null,
} as const;
