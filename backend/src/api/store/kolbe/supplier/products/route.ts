import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** کاتالوگ تأمینکننده جاری. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const context = await svc(req).supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const products = await svc(req).supplier.listSupplierCatalog(context.supplierId);
  ok(res, { products });
});

/** ثبت محصول جدید (submitted = در انتظار تأیید ادمین). */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const service = svc(req);
  const context = await service.supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const body = req.body as {
    name?: string; sku?: string; category?: string; description?: string;
    wholesalePrice?: number; imageUrl?: string; color?: string; colorHex?: string; size?: string; stock?: number;
  };
  if (!body?.name?.trim() || !body?.sku?.trim() || !body?.category?.trim()) {
    return ok(res, { error: "INVALID_INPUT" }, 422);
  }
  try {
    const product = await service.supplier.createSupplierProduct({
      supplierId: context.supplierId,
      name: body.name, sku: body.sku, category: body.category,
      description: body.description, wholesalePrice: Number(body.wholesalePrice ?? 0),
      imageUrl: body.imageUrl ?? null, color: body.color ?? "", colorHex: body.colorHex ?? null,
      size: body.size ?? "", stock: Number(body.stock ?? 0), status: "submitted",
    });
    ok(res, { product: { id: product.id, name: product.name, sku: product.sku, status: product.status } }, 201);
  } catch (error: any) {
    const code = error?.message === "DUPLICATE_SKU" ? "DUPLICATE_SKU" : "CREATE_FAILED";
    ok(res, { error: code }, 409);
  }
});
