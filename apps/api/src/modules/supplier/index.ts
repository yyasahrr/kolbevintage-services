import { Module, MedusaService } from "@medusajs/framework/utils";
import Supplier from "./models/supplier";
import SupplierMember from "./models/supplier-member";
import SupplierApplication from "./models/supplier-application";
import SupplierProduct from "./models/supplier-product";
import SupplierVariant from "./models/product-variant";
import SupplierInventory from "./models/inventory-item";

export const SUPPLIER_MODULE = "supplier";

export type VariantWithInventory = {
  id: string; sku: string; color: string; color_hex: string | null; size: string;
  inventory: { on_hand: number; reserved: number } | null;
};

export type SupplierProductRow = {
  id: string; supplier_id: string; name: string; sku: string; category: string;
  description: string; wholesale_price: number; image_url: string | null; status: string; updated_at?: string;
  product_variants: VariantWithInventory[];
};

/**
 * سرویس دامنه تأمین - منطق همه RPCهای Supabase اینجا منتقل شده است:
 * ثبت محصول اتمیک (با جبران خطا)، کاتالوگ VIP، رزرو/آزادسازی/مصرف موجودی.
 */
class SupplierModuleService extends MedusaService({
  Supplier,
  SupplierMember,
  SupplierApplication,
  SupplierProduct,
  SupplierVariant,
  SupplierInventory,
}) {
  /** ثبت محصول + واریانت + موجودی با جبران خطا (معادل INSERTهای زنجیره‌ای قدیمی). */
  async createSupplierProduct(input: {
    supplierId: string; name: string; sku: string; category: string; description?: string;
    wholesalePrice: number; imageUrl?: string | null; color: string; colorHex?: string | null;
    size: string; stock: number; status?: string;
  }) {
    const sku = input.sku.trim().toUpperCase();
    const dup = (await this.listSupplierProducts({ sku } as any)) as any[];
    if (dup.length > 0) throw new Error("DUPLICATE_SKU");
    const product = await this.createSupplierProducts({
      supplierId: input.supplierId, name: input.name.trim(), sku, category: input.category,
      description: (input.description ?? "").trim(), wholesalePrice: input.wholesalePrice,
      imageUrl: input.imageUrl?.trim() || null, status: (input.status ?? "submitted") as any,
    });
    const variantSku = `${sku}-${(input.color || "DEFAULT").trim().toUpperCase()}-${(input.size || "ONE").trim().toUpperCase()}`;
    try {
      const variant = await this.createSupplierVariants({
        productId: product.id, sku: variantSku, color: input.color?.trim() || "بدون رنگ",
        colorHex: input.colorHex ?? null, size: input.size?.trim() || "تک‌سایز", cost: input.wholesalePrice,
      });
      await this.createSupplierInventories({ variantId: variant.id, onHand: Math.max(0, input.stock), reserved: 0 });
      return product;
    } catch (error) {
      // جبران: اگر واریانت/موجودی شکست خورد، محصول هم حذف میشود.
      await this.deleteSupplierProducts(product.id);
      throw error;
    }
  }

  /** کاتالوگ یک تأمینکننده با واریانتها و موجودی (مرتب بر اساس جدیدترین). */
  async listSupplierCatalog(supplierId: string): Promise<SupplierProductRow[]> {
    const products = (await this.listSupplierProducts({ supplierId } as any)) as any[];
    return this.attachVariants(products);
  }

  /** کاتالوگ عمومی VIP - فقط محصولات تأییدشده همه تأمینکنندگان. */
  async listApprovedCatalog(): Promise<SupplierProductRow[]> {
    const products = (await this.listSupplierProducts({ status: "approved" } as any)) as any[];
    return this.attachVariants(products);
  }

  private async attachVariants(products: any[]): Promise<SupplierProductRow[]> {
    if (products.length === 0) return [];
    const variants = (await this.listSupplierVariants()) as any[];
    const inventories = (await this.listSupplierInventories()) as any[];
    const invByVariant = new Map<string, any>(inventories.map((inv) => [inv.variantId, inv]));
    const byProduct = new Map<string, VariantWithInventory[]>();
    for (const v of variants) {
      const inv = invByVariant.get(v.id);
      const row: VariantWithInventory = {
        id: v.id, sku: v.sku, color: v.color, color_hex: v.colorHex ?? null, size: v.size,
        inventory: inv ? { on_hand: inv.onHand ?? 0, reserved: inv.reserved ?? 0 } : { on_hand: 0, reserved: 0 },
      };
      if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
      byProduct.get(v.productId)!.push(row);
    }
    return products
      .slice()
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .map((p) => ({
        id: p.id, supplier_id: p.supplierId, name: p.name, sku: p.sku, category: p.category,
        description: p.description, wholesale_price: p.wholesalePrice, image_url: p.imageUrl,
        status: p.status, updated_at: p.updatedAt, product_variants: byProduct.get(p.id) ?? [],
      }));
  }

  /** رزرو موجودی (ثبت سفارش عمده) - در نبود موجودی خطا میدهد. */
  async reserveStock(variantId: string, quantity: number) {
    const [inv] = (await this.listSupplierInventories({ variantId } as any)) as any[];
    if (!inv) throw new Error("VARIANT_NOT_FOUND");
    const available = (inv.onHand ?? 0) - (inv.reserved ?? 0);
    if (available < quantity) throw new Error("INSUFFICIENT_STOCK");
    await this.updateSupplierInventories({ id: inv.id, reserved: inv.reserved + quantity });
    return true;
  }

  /** آزادسازی رزرو (لغو سفارش). */
  async releaseStock(variantId: string, quantity: number) {
    const [inv] = (await this.listSupplierInventories({ variantId } as any)) as any[];
    if (!inv) return;
    await this.updateSupplierInventories({ id: inv.id, reserved: Math.max(0, inv.reserved - quantity) });
  }

  /** مصرف رزرو (تحویل PO) - از on_hand و reserved کم میشود. */
  async consumeStock(variantId: string, quantity: number) {
    const [inv] = (await this.listSupplierInventories({ variantId } as any)) as any[];
    if (!inv) return;
    await this.updateSupplierInventories({
      id: inv.id,
      onHand: Math.max(0, inv.onHand - quantity),
      reserved: Math.max(0, inv.reserved - quantity),
    });
  }

  /** تأیید درخواست عضویت تأمینکننده + ساخت رکورد تأمینکننده. */
  async approveApplication(applicationId: string) {
    const [application] = (await this.listSupplierApplications({ id: applicationId } as any)) as any[];
    if (!application) throw new Error("APPLICATION_NOT_FOUND");
    if (application.status === "approved") throw new Error("ALREADY_APPROVED");
    const supplier = await this.createSuppliers({
      legalName: application.companyName, displayName: application.companyName,
      phone: application.phone, category: application.category,
      monthlyCapacity: application.monthlyCapacity, status: "approved",
    });
    await this.updateSupplierApplications({ id: applicationId, status: "approved" });
    return supplier;
  }

  /** ساخت دسترسی ورود برای تأمینکننده (userId از ماژول account). */
  async addSupplierMember(supplierId: string, userId: string, title = "مدیر تأمین") {
    const existing = (await this.listSupplierMembers({ userId } as any)) as any[];
    if (existing.length > 0) throw new Error("MEMBER_EXISTS");
    return this.createSupplierMembers({ supplierId, userId, title });
  }

  async getMemberContext(userId: string) {
    const [member] = (await this.listSupplierMembers({ userId } as any)) as any[];
    if (!member) return null;
    const [supplier] = (await this.listSuppliers({ id: member.supplierId } as any)) as any[];
    if (!supplier || supplier.status !== "approved") return null;
    return { supplierId: supplier.id, displayName: supplier.displayName, legalName: supplier.legalName };
  }
}

export default Module(SUPPLIER_MODULE, { service: SupplierModuleService });
