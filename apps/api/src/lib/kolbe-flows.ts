/**
 * جریانهای دامنه کلبه - ترکیب سرویسهای ماژول در عملیاتهای چندمرحلهای.
 * معادل منطق RPCهای تراکنشی Supabase، اینبار با جبران خطای صریح.
 */
import { WHOLESALE_MIN_UNITS } from "../modules/wholesale";
import type { MedusaContainer } from "@medusajs/framework";

type Services = {
  supplier: any;
  wholesale: any;
  purchaseOrder: any;
};

export function services(container: MedusaContainer): Services {
  return {
    supplier: container.resolve("supplier"),
    wholesale: container.resolve("wholesale"),
    purchaseOrder: container.resolve("purchase_order"),
  };
}

/** ثبت سفارش عمده VIP: اعتبارسنجی حساب و موجودی، ساخت سفارش + رزرو (اتمیک با جبران). */
export async function submitWholesaleOrderFlow(
  svc: Services,
  account: { id: string; status: string; expiresAt: Date | string | null },
  lines: Array<{ variantId: string; quantity: number }>,
) {
  if (account.status !== "approved") throw new Error("VIP_ACCOUNT_INACTIVE");
  if (account.expiresAt && new Date(account.expiresAt).getTime() <= Date.now()) throw new Error("VIP_ACCOUNT_INACTIVE");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("EMPTY_ORDER");

  const variants = (await svc.supplier.listSupplierVariants()) as any[];
  const products = (await svc.supplier.listSupplierProducts()) as any[];
  const productById = new Map(products.map((p: any) => [p.id, p]));

  let totalUnits = 0;
  let totalAmount = 0;
  const resolved: Array<{ product: any; variant: any; quantity: number }> = [];
  for (const line of lines) {
    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
    const variant = variants.find((v: any) => v.id === line.variantId);
    if (!variant) throw new Error("VARIANT_NOT_FOUND");
    const product = productById.get(variant.productId);
    if (!product || product.status !== "approved") throw new Error("PRODUCT_NOT_AVAILABLE");
    resolved.push({ product, variant, quantity });
    totalUnits += quantity;
    totalAmount += quantity * Number(product.wholesalePrice ?? 0);
  }
  if (totalUnits < WHOLESALE_MIN_UNITS) throw new Error("BELOW_MIN_UNITS");

  const orderCode = `KV-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const order = await svc.wholesale.createWholesaleOrders({
    orderCode, accountId: account.id, status: "pending", totalAmount, totalUnits,
  });

  // رزرو موجودی با جبران: در اولین خطا همه رزروها آزاد و سفارش حذف میشود.
  const reserved: Array<{ variantId: string; quantity: number }> = [];
  try {
    for (const item of resolved) {
      await svc.supplier.reserveStock(item.variant.id, item.quantity);
      reserved.push({ variantId: item.variant.id, quantity: item.quantity });
    }
    for (const item of resolved) {
      await svc.wholesale.createWholesaleOrderItems({
        orderId: order.id, productId: item.product.id, variantId: item.variant.id,
        productName: item.product.name, sku: item.variant.sku,
        quantity: item.quantity, unitPrice: Number(item.product.wholesalePrice ?? 0),
      });
    }
    return { orderCode };
  } catch (error) {
    for (const r of reserved) await svc.supplier.releaseStock(r.variantId, r.quantity);
    await svc.wholesale.deleteWholesaleOrders(order.id);
    throw error;
  }
}

/** تأیید سفارش عمده: گروهبندی ردیفها بر اساس ساپلایر و ساخت PO برای هر ساپلایر. */
export async function approveWholesaleOrderFlow(svc: Services, orderId: string, dueDate?: string | null) {
  const order = await svc.wholesale.getOrderWithItems(orderId);
  if (order.status !== "pending") throw new Error("ORDER_NOT_PENDING");

  const products = (await svc.supplier.listSupplierProducts()) as any[];
  const productById = new Map(products.map((p: any) => [p.id, p]));
  const suppliers = (await svc.supplier.listSuppliers()) as any[];

  const bySupplier = new Map<string, any[]>();
  for (const item of order.wholesale_order_items) {
    const product = productById.get(item.product_id);
    const supplierId = product?.supplierId;
    if (!supplierId) continue;
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    bySupplier.get(supplierId)!.push(item);
  }

  const createdPos: string[] = [];
  let index = 1;
  for (const [supplierId, items] of bySupplier) {
    const po = await svc.purchaseOrder.createPurchaseOrders({
      orderCode: `PO-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${index}`,
      supplierId, wholesaleOrderId: order.id, status: "pending",
      dueDate: dueDate ? new Date(dueDate) : null,
      totalAmount: items.reduce((sum: number, i: any) => sum + i.quantity * i.unit_price, 0),
    });
    for (const item of items) {
      await svc.purchaseOrder.createPurchaseOrderItems({
        purchaseOrderId: po.id, productName: item.product_name, sku: item.sku,
        variantId: item.variant_id ?? null, quantity: item.quantity,
        unitPrice: item.unit_price, totalAmount: item.quantity * item.unit_price,
      });
    }
    createdPos.push(po.id);
    index += 1;
  }

  await svc.wholesale.updateWholesaleOrders({ id: order.id, status: "approved" });
  void suppliers;
  return { order_id: order.id, purchase_orders: createdPos.length };
}

/** لغو سفارش عمده: آزادسازی رزروها + لغو POهای باز. */
export async function cancelWholesaleOrderFlow(svc: Services, orderId: string) {
  const order = await svc.wholesale.getOrderWithItems(orderId);
  if (order.status === "cancelled") return;
  if (order.status === "fulfilled") throw new Error("ORDER_ALREADY_FULFILLED");

  for (const item of order.wholesale_order_items) {
    await svc.supplier.releaseStock(item.variant_id, item.quantity);
  }
  const pos = await svc.purchaseOrder.listByWholesaleOrder(order.id);
  for (const po of pos) {
    if (po.status === "pending" || po.status === "confirmed" || po.status === "preparing") {
      await svc.purchaseOrder.updatePurchaseOrders({ id: po.id, status: "cancelled" });
    }
  }
  await svc.wholesale.updateWholesaleOrders({ id: order.id, status: "cancelled" });
}

/** تحویل PO: مصرف موجودی رزروشده + اگر همه POهای سفارش تحویل شد، سفارش fulfilled. */
export async function handlePurchaseOrderDeliveredFlow(svc: Services, purchaseOrderRow: any) {
  for (const item of purchaseOrderRow.purchase_order_items) {
    if (item.variantId) await svc.supplier.consumeStock(item.variantId, item.quantity);
  }
  const wholesaleOrderId = purchaseOrderRow.wholesale_order_id;
  if (!wholesaleOrderId) return;
  const pos = await svc.purchaseOrder.listByWholesaleOrder(wholesaleOrderId);
  const allDelivered = pos.length > 0 && pos.every((po: any) => po.status === "delivered" || po.status === "cancelled");
  if (allDelivered) {
    await svc.wholesale.updateWholesaleOrders({ id: wholesaleOrderId, status: "fulfilled" });
  }
}
