import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, svc } from "../../../../../lib/http";

/**
 * ثبت سفارش خردهفروشی - پایان دوران چکاوت دمویی!
 * سفارش مهمان با خطوط، آدرس، روش ارسال و روش پرداخت ذخیره میشود.
 * وضعیت پرداخت: درگاه -> pending_gateway (اتصال زرینپال فاز ۴).
 */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as {
    customer?: { name?: string; phone?: string; email?: string };
    lines?: Array<{ id: string; name: string; colour: string; size: string; price: number; qty: number; img?: string }>;
    address?: Record<string, string>;
    shipping?: { id?: string; label?: string; price?: number };
    payMethod?: string;
    totals?: { items?: number; shipping?: number; total?: number };
  };
  if (!Array.isArray(body?.lines) || body.lines.length === 0) {
    return ok(res, { error: "EMPTY_CART" }, 422);
  }
  if (!body?.customer?.name?.trim() || !body?.customer?.phone?.trim()) {
    return ok(res, { error: "CUSTOMER_INFO_REQUIRED" }, 422);
  }

  const orderCode = `RT-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const service = svc(req);
  await service.retail.createRetailOrders({
    orderCode,
    customerName: body.customer.name.trim(),
    phone: body.customer.phone.trim(),
    email: body.customer.email?.trim() || null,
    lines: body.lines,
    address: body.address ?? {},
    shippingMethod: body.shipping?.id ?? "post",
    shippingPrice: Number(body.totals?.shipping ?? 0),
    payMethod: body.payMethod ?? "gateway",
    totalAmount: Number(body.totals?.total ?? 0),
    paymentStatus: body.payMethod === "cod" ? "pending_cod" : "pending_gateway",
  });
  ok(res, { orderCode }, 201);
});
