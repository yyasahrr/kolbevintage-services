/**
 * نقشهٔ صفحات و ناوبریِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * معماریِ فعلی یک «پوستهٔ تک‌صفحه‌ای با تب» است؛ این فاز ساختارِ مسیری را
 * نمی‌شکند (سازگاریِ Phase 6.7)، اما هر صفحه یک شناسهٔ پایدار دارد و مسیرهای
 * عمیق (`?page=orders&id=...`) از طریقِ نشانیِ مرورگر قابل اشتراک‌گذاری هستند.
 */

import {
  Archive, Boxes, BriefcaseBusiness, ClipboardCheck, CreditCard, FileCheck2, FolderKanban,
  LayoutDashboard, MessageSquareText, Package, ShieldCheck, Store, TrendingUp, Truck, Users, Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SupplierPage =
  | 'dashboard'
  | 'products'
  | 'product-editor'
  | 'rfqs'
  | 'orders'
  | 'inventory'
  | 'finance'
  | 'withdrawals'
  | 'team'
  | 'compliance'
  | 'support'
  | 'analytics'
  | 'production'
  | 'capacity'
  | 'settings'

export type NavLink = { page: SupplierPage; label: string; icon: LucideIcon; capability?: boolean }

export type NavGroup = { label?: string; links: NavLink[] }

export const NAV_GROUPS: NavGroup[] = [
  { links: [{ page: 'dashboard', label: 'داشبورد', icon: LayoutDashboard }] },
  {
    label: 'کاتالوگ',
    links: [
      { page: 'products', label: 'محصولات', icon: Package },
      { page: 'product-editor', label: 'ثبت محصول جدید', icon: FileCheck2 },
    ],
  },
  {
    label: 'موجودی و سفارش',
    links: [
      { page: 'inventory', label: 'موجودی', icon: Boxes },
      { page: 'orders', label: 'سفارش‌ها', icon: Truck },
    ],
  },
  {
    label: 'تولید سفارشی',
    links: [
      { page: 'rfqs', label: 'صندوق RFQ', icon: MessageSquareText },
      { page: 'production', label: 'تولید و کنترل کیفیت', icon: FolderKanban, capability: true },
      { page: 'capacity', label: 'ظرفیت و تعطیلی', icon: Archive, capability: true },
    ],
  },
  {
    label: 'مالی',
    links: [
      { page: 'finance', label: 'مالی و تسویه', icon: CreditCard },
      { page: 'withdrawals', label: 'برداشت‌ها', icon: Wallet },
    ],
  },
  {
    label: 'حساب کاربری',
    links: [
      { page: 'team', label: 'تیم و دسترسی‌ها', icon: Users },
      { page: 'compliance', label: 'انطباق و اسناد', icon: ShieldCheck },
      { page: 'support', label: 'پشتیبانی', icon: MessageSquareText },
      { page: 'analytics', label: 'عملکرد', icon: TrendingUp },
      { page: 'settings', label: 'تنظیمات کارخانه', icon: Store },
    ],
  },
]

export const PAGE_TITLES: Record<SupplierPage, { title: string; parent?: string; description?: string }> = {
  dashboard: { title: 'داشبورد', description: 'در یک نگاه ببینید چه چیزی امروز به تصمیم شما نیاز دارد.' },
  products: { title: 'محصولات', parent: 'کاتالوگ', description: 'کاتالوگ، وضعیت بررسی کلبه و پیشنهادهای ثبت‌شدهٔ شما.' },
  'product-editor': { title: 'ثبت محصول جدید', parent: 'کاتالوگ', description: 'پیشنهادِ محصول برای بررسی تیم کلبه.' },
  rfqs: { title: 'صندوق RFQ', parent: 'تولید سفارشی', description: 'درخواست‌های تولید را بررسی و برای آن‌ها پیشنهاد قیمت ثبت کنید.' },
  orders: { title: 'سفارش‌ها', parent: 'عملیات', description: 'سفارش‌ها را تأیید، آماده و ارسال کنید.' },
  inventory: { title: 'موجودی', parent: 'موجودی', description: 'موجودی و رزروشده‌ها از مرجعِ سرور خوانده می‌شوند.' },
  finance: { title: 'مالی و تسویه', parent: 'مالی', description: 'خلاصهٔ حساب، گردش مالی و پیش‌فاکتورها.' },
  withdrawals: { title: 'برداشت‌ها', parent: 'مالی', description: 'درخواست و پیگیری برداشت از موجودی قابل برداشت.' },
  team: { title: 'تیم و دسترسی‌ها', parent: 'حساب کاربری', description: 'اعضا، نقش‌ها و مجوزهای ثبت‌شده در سرور.' },
  compliance: { title: 'انطباق و اسناد', parent: 'حساب کاربری', description: 'پروفایل انطباق، اسناد، توافق‌نامه و حساب بانکی.' },
  support: { title: 'پشتیبانی', parent: 'حساب کاربری', description: 'پرونده‌های پشتیبانی و گفت‌وگو با تیم کلبه.' },
  analytics: { title: 'عملکرد', parent: 'تحلیل', description: 'شاخص‌های عملیاتی و مالی از سرویس تحلیل.' },
  production: { title: 'تولید و کنترل کیفیت', parent: 'تولید سفارشی', description: 'شغل‌های تولید، نمونه، لات، بازرسی و نقص‌ها.' },
  capacity: { title: 'ظرفیت و تعطیلی', parent: 'تولید سفارشی', description: 'دوره‌های ظرفیت و روزهای تعطیل کارخانه.' },
  settings: { title: 'تنظیمات کارخانه', parent: 'حساب کاربری', description: 'ظرفیت، دوره‌های تولید و تعطیلی‌ها.' },
}

/** آیکون‌های بدون استفادهٔ مستقیم اما بخشی از واژگانِ بصری (برای برچسب‌های وضعیت). */
export const NAV_ICONS = { Archive, BriefcaseBusiness, ClipboardCheck } as const
