import { describe, expect, it } from "vitest";
import { rows } from "../server/database";
import { call, createCustomer, login, uniqueSuffix } from "./helpers";

/**
 * آزمون‌های عضویت VIP / عمده‌فروشی.
 *
 * رگرسیون ایراد P0 ممیزی (D2): `POST wholesale/apply` عضویت را بلافاصله
 * `approved` می‌کرد و نقش کاربر را به `vip` ارتقا می‌داد — یعنی هر مشتری با یک
 * رشتهٔ پیگیری پرداخت دلخواه به قیمت‌های عمده دسترسی می‌گرفت.
 */

const application = () => ({
  memberName: "فروشگاه آزمون",
  storeName: `فروشگاه آزمون ${uniqueSuffix()}`,
  phone: "09121234567",
  city: "تهران",
  planName: "وی‌آی‌پی",
  paymentReference: "VIP-TEST-REFERENCE",
});

describe("عضویت VIP — درخواست و تأیید", () => {
  it("درخواست عضویت را «در انتظار تأیید» ثبت می‌کند، نه «تأییدشده» (رگرسیون D2)", async () => {
    const customer = await createCustomer();
    const result = await call("wholesale/apply", {
      method: "POST",
      body: application(),
      token: customer.token,
    });

    expect(result.status).toBe(201);
    expect(result.body.status).toBe("pending");
    expect(result.body.account.status).toBe("pending");
    // هیچ‌گاه نباید activated_at/expires_at در مرحلهٔ درخواست پر شود.
    expect(result.body.account.activated_at).toBeNull();
    expect(result.body.account.expires_at).toBeNull();
  });

  it("نقش کاربر را در مرحلهٔ درخواست به vip ارتقا نمی‌دهد (D2)", async () => {
    const customer = await createCustomer();
    await call("wholesale/apply", { method: "POST", body: application(), token: customer.token });

    const user = await rows<{ role: string }>("SELECT role FROM account_user WHERE id=$1", [customer.userId]);
    expect(user[0].role).toBe("customer");
  });

  it("تا زمانی که تأیید نشده، به کاتالوگ و سفارش عمده دسترسی ندارد", async () => {
    const customer = await createCustomer();
    await call("wholesale/apply", { method: "POST", body: application(), token: customer.token });

    const products = await call("wholesale/products", { token: customer.token });
    expect(products.status).toBe(403);
    expect(products.body.error).toBe("VIP_ACCOUNT_INACTIVE");

    const order = await call("wholesale/orders", { method: "POST", body: { lines: [] }, token: customer.token });
    expect(order.status).toBe(403);
  });

  it("درخواست تکراری، عضویت در انتظار را بازنشانی نمی‌کند", async () => {
    const customer = await createCustomer();
    const first = await call("wholesale/apply", { method: "POST", body: application(), token: customer.token });
    const second = await call("wholesale/apply", { method: "POST", body: application(), token: customer.token });

    expect(second.status).toBe(201);
    expect(second.body.account.id).toBe(first.body.account.id);

    const count = await rows<{ count: string }>(
      "SELECT count(*) AS count FROM wholesale_account WHERE user_id=$1",
      [customer.userId],
    );
    expect(Number(count[0].count)).toBe(1);
  });

  it("فقط مدیر می‌تواند عضویت را تأیید کند و آن‌وقت نقش ارتقا می‌یابد", async () => {
    const customer = await createCustomer();
    const applied = await call("wholesale/apply", {
      method: "POST",
      body: application(),
      token: customer.token,
    });
    const accountId = applied.body.account.id;

    // مشتری نمی‌تواند خودش را تأیید کند.
    const selfApproval = await call(`admin/accounts/${accountId}/status`, {
      method: "POST",
      body: { status: "approved" },
      token: customer.token,
    });
    expect(selfApproval.status).toBe(401);

    const admin = await login("admin");
    const approved = await call(`admin/accounts/${accountId}/status`, {
      method: "POST",
      body: { status: "approved" },
      token: admin.token,
    });
    expect(approved.status).toBe(200);

    const user = await rows<{ role: string }>("SELECT role FROM account_user WHERE id=$1", [customer.userId]);
    expect(user[0].role).toBe("vip");

    // حالا دسترسی عمده باز است.
    const products = await call("wholesale/products", { token: customer.token });
    expect(products.status).toBe(200);
    expect(Array.isArray(products.body.products)).toBe(true);
  });

  it("رد عضویت، دسترسی را می‌بندد و نقش را برمی‌گرداند", async () => {
    const customer = await createCustomer();
    const applied = await call("wholesale/apply", {
      method: "POST",
      body: application(),
      token: customer.token,
    });
    const accountId = applied.body.account.id;
    const admin = await login("admin");

    await call(`admin/accounts/${accountId}/status`, {
      method: "POST",
      body: { status: "approved" },
      token: admin.token,
    });
    await call(`admin/accounts/${accountId}/status`, {
      method: "POST",
      body: { status: "rejected" },
      token: admin.token,
    });

    const user = await rows<{ role: string }>("SELECT role FROM account_user WHERE id=$1", [customer.userId]);
    expect(user[0].role).toBe("customer");

    const products = await call("wholesale/products", { token: customer.token });
    expect(products.status).toBe(403);
  });

  it("وضعیت نامعتبر برای عضویت پذیرفته نمی‌شود", async () => {
    const customer = await createCustomer();
    const applied = await call("wholesale/apply", {
      method: "POST",
      body: application(),
      token: customer.token,
    });
    const admin = await login("admin");
    const result = await call(`admin/accounts/${applied.body.account.id}/status`, {
      method: "POST",
      body: { status: "super-user" },
      token: admin.token,
    });
    expect(result.status).toBe(422);
  });
});
