export interface NavItem {
  path: string;
  label: string;
  group: "operations" | "catalogue" | "finance" | "insight";
  icon: string;
  description: string;
}

/** All admin routes live under /admin so the storefront keeps the root path. */
export const NAV_ITEMS: NavItem[] = [
  { path: "/admin", label: "داشبورد", group: "operations", icon: "◧", description: "نمای کلی عملیات عمده‌فروشی" },
  { path: "/admin/orders", label: "سفارش‌ها", group: "operations", icon: "▤", description: "سفارش‌های مشتریان VIP" },
  { path: "/admin/fulfillment", label: "تأمین و ارسال", group: "operations", icon: "⇉", description: "درخواست‌های تأمین و مرسولات" },
  { path: "/admin/suppliers", label: "تأمین‌کنندگان", group: "operations", icon: "▦", description: "عملکرد و مدیریت تأمین‌کنندگان" },
  {
    path: "/admin/applications",
    label: "درخواست‌های همکاری",
    group: "operations",
    icon: "✉",
    description: "بررسی و تأیید تأمین‌کنندگان جدید",
  },
  { path: "/admin/vip-customers", label: "مشتریان VIP", group: "operations", icon: "★", description: "تحلیل مشتریان عمده" },
  {
    path: "/admin/products",
    label: "مدیریت محصولات",
    group: "catalogue",
    icon: "❏",
    description: "افزودن، ویرایش و قیمت‌گذاری محصولات",
  },
  {
    path: "/admin/catalogues",
    label: "مدیریت کاتالوگ‌ها",
    group: "catalogue",
    icon: "▣",
    description: "ساخت و ویرایش کاتالوگ‌های عمده",
  },
  {
    path: "/admin/catalogue-analytics",
    label: "تحلیل کاتالوگ",
    group: "catalogue",
    icon: "◔",
    description: "عملکرد فروش کاتالوگ‌ها و محصولات",
  },
  { path: "/admin/escrow", label: "امانی (Escrow)", group: "finance", icon: "⛨", description: "وجوه نگهداری‌شده و بازرسی" },
  { path: "/admin/settlements", label: "تسویه تأمین‌کننده", group: "finance", icon: "⇄", description: "پرداخت‌های تأمین‌کنندگان" },
  { path: "/admin/disputes", label: "اختلافات", group: "finance", icon: "⚠", description: "اختلافات و وجوه مسدود" },
  { path: "/admin/analytics", label: "تحلیل‌ها", group: "insight", icon: "◑", description: "تحلیل عمیق کسب‌وکار" },
  { path: "/admin/reports", label: "گزارش‌ها", group: "insight", icon: "⎙", description: "گزارش‌های قابل خروجی" },
  { path: "/admin/settings", label: "تنظیمات", group: "insight", icon: "⚙", description: "قواعد کسب‌وکار و ظاهر" },
];

export const GROUP_LABEL: Record<NavItem["group"], string> = {
  operations: "عملیات",
  catalogue: "کاتالوگ و محصولات",
  finance: "مالی",
  insight: "تحلیل و تنظیمات",
};
