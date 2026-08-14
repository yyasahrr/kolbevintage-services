export interface NavItem {
  path: string;
  label: string;
  group: "operations" | "finance" | "insight" | "partner";
  icon: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", label: "داشبورد", group: "operations", icon: "◧", description: "نمای کلی عملیات عمده‌فروشی" },
  { path: "/orders", label: "سفارش‌ها", group: "operations", icon: "▤", description: "سفارش‌های مشتریان VIP" },
  { path: "/fulfillment", label: "تأمین و ارسال", group: "operations", icon: "⇉", description: "درخواست‌های تأمین و مرسولات" },
  { path: "/suppliers", label: "تأمین‌کنندگان", group: "operations", icon: "▦", description: "عملکرد تأمین‌کنندگان" },
  { path: "/vip-customers", label: "مشتریان VIP", group: "operations", icon: "★", description: "تحلیل مشتریان عمده" },
  { path: "/catalogue", label: "کاتالوگ عمده", group: "operations", icon: "❏", description: "کاتالوگ‌ها و محصولات" },
  { path: "/escrow", label: "امانی (Escrow)", group: "finance", icon: "⛨", description: "وجوه نگهداری‌شده و بازرسی" },
  { path: "/settlements", label: "تسویه تأمین‌کننده", group: "finance", icon: "⇄", description: "پرداخت‌های تأمین‌کنندگان" },
  { path: "/disputes", label: "اختلافات", group: "finance", icon: "⚠", description: "اختلافات و وجوه مسدود" },
  { path: "/analytics", label: "تحلیل‌ها", group: "insight", icon: "◔", description: "تحلیل عمیق کسب‌وکار" },
  { path: "/reports", label: "گزارش‌ها", group: "insight", icon: "⎙", description: "گزارش‌های قابل خروجی" },
  { path: "/settings", label: "تنظیمات", group: "insight", icon: "⚙", description: "قواعد کسب‌وکار و ظاهر" },
  {
    path: "/supplier-portal",
    label: "پورتال تأمین‌کننده",
    group: "partner",
    icon: "◈",
    description: "نمای ایزوله تأمین‌کننده — بدون دسترسی به داده مشتری",
  },
];

export const GROUP_LABEL: Record<NavItem["group"], string> = {
  operations: "عملیات",
  finance: "مالی",
  insight: "تحلیل و تنظیمات",
  partner: "نمای شرکا",
};
