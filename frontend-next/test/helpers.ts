import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { handleKolbeRequest } from "../server/kolbe-api";
import { rows } from "../server/database";

/**
 * ابزار مشترک تست‌ها.
 *
 * `handleKolbeRequest` فقط به `headers`, `method`, `url` و `json()` نیاز دارد،
 * پس `Request` استاندارد وب کافی است و نیازی به بالا آوردن سرور Next نیست.
 */
export function asNextRequest(request: Request): NextRequest {
  return request as unknown as NextRequest;
}

export const API_ORIGIN = "http://localhost:3000";
let requestIpSequence = 10;

export async function call(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { ...init.headers };
  if (!headers["x-forwarded-for"]) {
    requestIpSequence = requestIpSequence >= 250 ? 10 : requestIpSequence + 1;
    headers["x-forwarded-for"] = `127.0.1.${requestIpSequence}`;
  }
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  const response = await handleKolbeRequest(
    asNextRequest(
      new Request(`${API_ORIGIN}/store/kolbe/${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    ),
    path.split("/"),
  );

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

export function uniqueSuffix() {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

export const DEMO_PASSWORDS = {
  admin: "KolbeAdmin1404!",
  vip: "VipPass1404!",
  supplier: "SupplierPass1404!",
} as const;

export const DEMO_EMAILS = {
  admin: "admin@kolbe.ir",
  vip: "vip@boutique.ir",
  supplier: "nilgoon@kolbe.ir",
} as const;

export async function login(role: "admin" | "vip" | "supplier") {
  const result = await call("auth/login", {
    method: "POST",
    body: { email: DEMO_EMAILS[role], password: DEMO_PASSWORDS[role] },
  });
  if (result.status !== 200) {
    throw new Error(`ورود ${role} ناموفق بود: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return { token: result.body.token as string, user: result.body.user, response: result };
}

/** ساخت یک مشتری تازه برای تست‌هایی که به هویت مستقل نیاز دارند. */
export async function createCustomer() {
  const suffix = uniqueSuffix();
  const email = `customer-${suffix}@example.test`;
  const password = "CustomerPass1404!";
  const registered = await call("auth/register", {
    method: "POST",
    body: { email, password, name: `مشتری ${suffix}`, phone: "09120000000" },
  });
  if (registered.status !== 201) {
    throw new Error(`ثبت‌نام ناموفق بود: ${registered.status} ${JSON.stringify(registered.body)}`);
  }
  const loggedIn = await call("auth/login", { method: "POST", body: { email, password } });
  return { email, password, userId: loggedIn.body.user.id as string, token: loggedIn.body.token as string };
}

/** یافتن شناسهٔ یک variant موجود عمده‌فروشی برای تست سفارش — canonical. */
export async function firstApprovedVariant() {
  const found = await rows<{ variant_id: string; product_id: string; wholesale_price: string }>(
    `SELECT v.id AS variant_id, p.id AS product_id, so.wholesale_price::text as wholesale_price
     FROM product_variant v JOIN product p ON p.id=v.product_id JOIN seller_offer so ON so.variant_id=v.id
     WHERE p.status='published' AND so.status='active' ORDER BY v.id LIMIT 1`,
  );
  if (!found[0]) throw new Error("هیچ variant تأییدشده‌ای در دیتابیس تست پیدا نشد");
  return found[0];
}

/**
 * ساخت یک عضو VIP تأییدشده (عضویت عمده فعال) برای تست‌های سفارش عمده.
 *
 * مسیر کامل طی می‌شود چون در ممیزی اثبات شد خودْتأییدی ممکن نیست (D2/P7):
 * مشتری درخواست می‌دهد → «در انتظار» می‌ماند → فقط مدیر تأیید می‌کند.
 */
export async function approvedVip() {
  const customer = await createCustomer();
  const applied = await call("wholesale/apply", {
    method: "POST",
    body: {
      memberName: "فروشگاه آزمون",
      storeName: `فروشگاه آزمون ${uniqueSuffix()}`,
      phone: "09121234567",
      city: "تهران",
      planName: "وی‌آی‌پی",
      paymentReference: "VIP-TEST-REFERENCE",
    },
    token: customer.token,
  });
  if (applied.status !== 201) {
    throw new Error(`درخواست عضویت ناموفق بود: ${applied.status} ${JSON.stringify(applied.body)}`);
  }
  const admin = await login("admin");
  const approved = await call(`admin/accounts/${applied.body.account.id}/status`, {
    method: "POST",
    body: { status: "approved" },
    token: admin.token,
  });
  if (approved.status !== 200) {
    throw new Error(`تأیید عضویت ناموفق بود: ${approved.status} ${JSON.stringify(approved.body)}`);
  }
  return { ...customer, accountId: applied.body.account.id as string, adminToken: admin.token };
}
