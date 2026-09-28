/**
 * مجوزهای تأمین‌کننده — قابل تنظیم توسط ادمین
 * create_product, change_images, change_description, add_variant, change_category, change_price
 */

import { CatalogDomainError } from "../catalog/catalog.logic";

export type PermissionAction =
  | "create_product"
  | "change_images"
  | "change_description"
  | "add_variant"
  | "change_category"
  | "change_price";

export type PermissionConfig = {
  action: PermissionAction;
  requiresApproval: boolean;
};

export type SupplierActionRequest = {
  action: PermissionAction;
  supplierId: string;
  productId?: string;
  payload?: any;
};

/**
 * بررسی مجوز — اگر نیاز به تأیید داشته باشد، باید در صف تأیید برود
 */
export function checkSupplierPermission(
  request: SupplierActionRequest,
  configs: PermissionConfig[],
): { allowed: boolean; requiresApproval: boolean } {
  const config = configs.find((c) => c.action === request.action);
  if (!config) {
    throw new CatalogDomainError("PERMISSION_NOT_CONFIGURED", `مجوز ${request.action} پیکربندی نشده است`);
  }

  // مثال: تغییر قیمت ممکن است ممنوع باشد (requiresApproval همیشه true و حتی ادمین باید تأیید کند)
  // یا create_product نیاز به تأیید دارد

  return {
    allowed: true,
    requiresApproval: config.requiresApproval,
  };
}

/**
 * نقش‌های شرکت تأمین‌کننده: Owner/Sales/Warehouse/Finance
 */
export type SupplierMemberRole = "owner" | "sales" | "warehouse" | "finance";

export function assertSupplierMemberRoleAllowed(
  role: SupplierMemberRole,
  action: PermissionAction,
): void {
  const rolePermissions: Record<SupplierMemberRole, PermissionAction[]> = {
    owner: ["create_product", "change_images", "change_description", "add_variant", "change_category", "change_price"],
    sales: ["change_price", "change_description"],
    warehouse: ["add_variant", "change_images"],
    finance: ["change_price"],
  };

  if (!rolePermissions[role]?.includes(action)) {
    throw new CatalogDomainError(
      "ROLE_NOT_ALLOWED",
      `نقش ${role} اجازهٔ ${action} را ندارد`,
    );
  }
}
