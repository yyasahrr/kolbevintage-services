/**
 * قراردادِ دامنهٔ «تیمِ تأمین‌کننده» — فاز ۶.۲ (بند C).
 *
 * ── چه چیزی واقعاً در اسکیما وجود دارد ────────────────────────────────────────
 * جدولِ `supplier_member` (packages/database/src/schema/tables.ts):
 *     id, supplier_id (FK→supplier, restrict), user_id (FK→account_user,
 *     restrict, **UNIQUE**), title, role (CHECK ∈ SUPPLIER_MEMBER_ROLES),
 *     created_at, updated_at
 *
 * پیامدهای مستقیمِ همین اسکیما — بدونِ هیچ حدس و بدونِ مهاجرت:
 *
 *  ۱) `user_id` یکتا است ⇒ یک کاربرِ پلتفرم هم‌زمان فقط به **یک** تأمین‌کننده
 *     تعلق دارد. پس «عضویت» یک رابطهٔ یک‌به‌یک است، نه چندبه‌چند.
 *  ۲) ستونِ `status`/`active`/`invited_at`/`email` وجود **ندارد** ⇒
 *     - «دعوت‌نامهٔ ایمیلی» قابلِ پیاده‌سازی نیست (نه جدولِ invitation، نه
 *       ستونِ ایمیل، نه وضعیتِ pending). آنچه دامنه پشتیبانی می‌کند «افزودنِ
 *       یک حسابِ کاربریِ **موجود** به تیم» است و همین پیاده شده است.
 *     - «غیرفعال‌سازی» به‌معنایِ نگه‌داشتنِ ردیف با پرچمِ غیرفعال ممکن نیست؛
 *       تنها معناىِ پشتیبانی‌شده «حذفِ عضویت» است. وضعیتِ حسابِ خودِ کاربر از
 *       `account_user.status` خوانده و در پاسخ گزارش می‌شود (منبعِ حقیقتِ
 *       «فعال بودن» همان‌جاست، نه در این جدول).
 *  ۳) نقش‌ها فقط چهار مقدارند و قیدِ CHECK در دیتابیس هم آن‌ها را محدود کرده
 *     است؛ پس افزودنِ نقشِ تازه بدونِ مهاجرت ممکن نیست و لازم هم نبود.
 *
 * ── سیاست‌های نقش ────────────────────────────────────────────────────────────
 * این فایل همان الگوی `compliance.contract.ts` را دنبال می‌کند: سیاستِ نقش به‌صورت
 * ثابتِ صادرشده و قابلِ تست اعلام می‌شود تا هم بک‌اند و هم فرانت یک منبعِ واحد
 * داشته باشند و سیاست در مرورگر بازتعریف نشود.
 */

import { SUPPLIER_MEMBER_ROLES } from "@kolbe/database";

/** نقش‌های مجازِ عضوِ تیم — دقیقاً همان قیدِ CHECK دیتابیس. */
export const TEAM_MEMBER_ROLES: readonly string[] = SUPPLIER_MEMBER_ROLES;

/**
 * سیاستِ کسب‌وکار: چه کسی می‌تواند تیم را ببیند.
 *
 * فهرستِ تیم برای همهٔ نقش‌ها خواندنی است (همان منطقِ
 * `SUPPLIER_COMPLIANCE_VIEWER_ROLES`): اعضای تیم باید بدانند چه کسی در تیم است.
 */
export const SUPPLIER_TEAM_VIEWER_ROLES: readonly string[] = ["owner", "finance", "sales", "warehouse"];

/**
 * سیاستِ کسب‌وکار: چه کسی می‌تواند عضویت را تغییر دهد.
 *
 * فقط `owner`. دلیل: در این مدل، نقش‌ها «دسترسی» هستند و `owner` بالاترین نقش
 * است؛ اگر نقشِ پایین‌تر می‌توانست نقشِ دیگران (یا نقشِ خودش) را تغییر دهد،
 * ارتقای دسترسیِ خودش ممکن می‌شد. محدودکردن به `owner` هم «خود-ارتقایی» را
 * می‌بندد و هم قاعدهٔ «نمی‌توانی دسترسی‌ای اعطا کنی که خودت نداری» را بدیهی
 * می‌کند — چون اعطاکننده بالاترین نقش را دارد.
 */
export const SUPPLIER_TEAM_MANAGER_ROLES: readonly string[] = ["owner"];

/** برچسبِ فارسیِ نقش‌ها — برای نمایش در پورتال. */
export const TEAM_MEMBER_ROLE_LABELS: Record<string, string> = {
  owner: "مالک",
  sales: "فروش",
  warehouse: "انبار",
  finance: "مالی",
};

/**
 * کارهایی که هر نقش می‌تواند انجام دهد.
 *
 * منبع: `supplier-permissions.logic.ts` (همان نقشه‌ای که
 * `assertSupplierMemberRoleAllowed` از آن استفاده می‌کند). اینجا فقط **بازنشرِ
 * خواندنی** است تا پورتال بتواند «دسترسی‌های این نقش» را از سرور بگیرد و هیچ
 * سیاستی را در مرورگر بازتعریف نکند.
 */
export const TEAM_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ["create_product", "change_images", "change_description", "add_variant", "change_category", "change_price"],
  sales: ["change_price", "change_description"],
  warehouse: ["add_variant", "change_images"],
  finance: ["change_price"],
};

export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

/** آیا این رشته یک نقشِ مجاز است؟ */
export function isTeamMemberRole(value: unknown): value is TeamMemberRole {
  return typeof value === "string" && (TEAM_MEMBER_ROLES as readonly string[]).includes(value);
}

/** آیا این نقش اجازهٔ مدیریتِ تیم را دارد؟ */
export function canManageTeam(role: string | null | undefined): boolean {
  return typeof role === "string" && SUPPLIER_TEAM_MANAGER_ROLES.includes(role);
}

/** آیا این نقش اجازهٔ دیدنِ تیم را دارد؟ */
export function canViewTeam(role: string | null | undefined): boolean {
  return typeof role === "string" && SUPPLIER_TEAM_VIEWER_ROLES.includes(role);
}

/** شکلِ عضوِ تیم در پاسخِ API. */
export type TeamMemberView = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  title: string;
  /** وضعیتِ حسابِ کاربر از `account_user.status` — نه از `supplier_member`. */
  userStatus: string;
  createdAt: string | null;
  /** آیا این ردیف، خودِ کاربرِ درخواست‌دهنده است؟ */
  isSelf: boolean;
};

/** شکلِ نقش در پاسخِ API. */
export type TeamRoleView = {
  code: string;
  label: string;
  permissions: readonly string[];
  canManageTeam: boolean;
};
