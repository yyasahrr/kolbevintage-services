import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** کاتالوگ کامل بازار عمده با نام تأمینکننده و موجودی هر واریانت. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const service = svc(req);
  const all = (await service.supplier.listSupplierProducts()) as any[];
  const catalog = await service.supplier.attachVariants(all);
  const suppliers = (await service.supplier.listSuppliers()) as any[];
  const supplierById = new Map(suppliers.map((s: any) => [s.id, s.displayName]));
  ok(res, {
    products: catalog.map((p: any) => ({
      id: p.id, name: p.name, sku: p.sku, category: p.category, wholesale_price: p.wholesale_price,
      image_url: p.image_url, status: p.status,
      supplier_name: supplierById.get(p.supplier_id) ?? "—",
      stock: (p.product_variants ?? []).reduce((sum: number, v: any) => sum + (v.inventory?.on_hand ?? 0), 0),
    })),
  });
});
