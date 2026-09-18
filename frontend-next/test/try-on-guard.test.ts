import { describe, expect, it } from "vitest";
import {
  TRY_ON_TASK_LIMIT_PER_DAY,
  TRY_ON_TASK_LIMIT_PER_HOUR,
  consumeTryOnTaskQuota,
  consumeTryOnUploadQuota,
  TRY_ON_UPLOAD_LIMIT_PER_HOUR,
} from "../server/try-on-guard";
import { resetRateLimits } from "../server/rate-limit";
import { call, createCustomer, login } from "./helpers";

/**
 * رگرسیون D20 — مسیر پرو مجازی بدون احراز هویت و بدون سقف مصرف.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 * `try-on/*` **پیش از** زنجیرهٔ احراز هویت و پیش از `await database()` پردازش
 * می‌شد. هر کاربر ناشناس (یا ربات) می‌توانست با کلید پولی Perfect Corp کلبه
 * فایل آپلود کند و task بسازد: هزینهٔ مستقیم، مصرف سهمیهٔ ارائه‌دهنده، و هیچ
 * ردی از مصرف‌کننده.
 *
 * ── اصلاح ───────────────────────────────────────────────────────────────────
 *   ۱) نشست (customer/vip) الزامی — پیش از رسیدن به ارائه‌دهنده.
 *   ۲) سقف ساعتی و روزانه روی عملیات هزینه‌زا (آپلود فایل، ساخت task).
 *   ۳) سهمیه روی شناسهٔ کاربرِ امضاشده بسته می‌شود، نه IP (قابل جعل با XFF).
 */

describe("سهمیهٔ پرو مجازی — واحد (D20)", () => {
  it("سقف ساعتی را دقیقاً روی مرز اعمال می‌کند", () => {
    resetRateLimits();
    const userId = "usr_quota_boundary";

    for (let index = 0; index < TRY_ON_TASK_LIMIT_PER_HOUR; index += 1) {
      expect(consumeTryOnTaskQuota(userId).allowed).toBe(true);
    }

    const overflow = consumeTryOnTaskQuota(userId);
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
    expect(overflow.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("سقف روزانه مستقل از سقف ساعتی اعمال می‌شود", () => {
    resetRateLimits();
    const userId = "usr_quota_daily";
    const now = Date.now();

    // پنجرهٔ ساعتی را با جابه‌جایی زمان رد می‌کنیم تا سقف روزانه دیده شود.
    const hour = 60 * 60 * 1000;
    let allowed = 0;
    for (let index = 0; index < TRY_ON_TASK_LIMIT_PER_DAY + 5; index += 1) {
      const decision = consumeTryOnTaskQuota(userId, now + index * (hour + 1));
      if (decision.allowed) allowed += 1;
      else break;
    }
    expect(allowed).toBe(TRY_ON_TASK_LIMIT_PER_DAY);
  });

  it("سهمیهٔ هر کاربر جداست و سهمیهٔ آپلود سقف خودش را دارد", () => {
    resetRateLimits();

    for (let index = 0; index < TRY_ON_UPLOAD_LIMIT_PER_HOUR; index += 1) {
      expect(consumeTryOnUploadQuota("usr_a").allowed).toBe(true);
    }
    expect(consumeTryOnUploadQuota("usr_a").allowed).toBe(false);
    // کاربر دیگر سهمیهٔ دست‌نخورده دارد.
    expect(consumeTryOnUploadQuota("usr_b").allowed).toBe(true);
  });
});

describe("try-on/* — نگهبان مسیر (D20)", () => {
  it("بدون نشست، حتی خواندن وضعیت task رد می‌شود (رگرسیون D20)", async () => {
    const taskList = await call("try-on/tasks", { method: "POST", body: { fileId: "f", garmentId: "g" } });
    expect(taskList.status).toBe(401);
    expect(taskList.body.error).toBe("UNAUTHORIZED");

    const fileUpload = await call("try-on/files", { method: "POST", body: {} });
    expect(fileUpload.status).toBe(401);

    const status = await call("try-on/tasks/task_unknown");
    expect(status.status).toBe(401);
  });

  it("با نشست معتبر به ارائه‌دهنده می‌رسد (نه ۴۰۱) و پس از سقف، ۴۲۹ می‌گیرد", async () => {
    resetRateLimits();
    const customer = await createCustomer();

    const statuses: number[] = [];
    for (let index = 0; index < TRY_ON_TASK_LIMIT_PER_HOUR + 2; index += 1) {
      const result = await call("try-on/tasks", {
        method: "POST",
        body: { fileId: "f", garmentId: "g" },
        token: customer.token,
      });
      statuses.push(result.status);
    }

    // شش درخواست اول از لایهٔ احراز هویت و سهمیه عبور می‌کنند (خطای ارائه‌دهنده
    // تنظیم‌نشدهٔ ۴۲۲/۵xx قابل قبول است) اما هرگز ۴۰۱ یا ۴۲۹ نیستند.
    const firstSix = statuses.slice(0, TRY_ON_TASK_LIMIT_PER_HOUR);
    expect(firstSix.every((status) => status !== 401 && status !== 429)).toBe(true);

    // از درخواست هفتم به بعد سهمیه بسته است.
    expect(statuses.slice(TRY_ON_TASK_LIMIT_PER_HOUR)).toEqual([429, 429]);
  });

  it("نقش مدیرِ بدون مجوز مشتری در این مسیر پذیرفته نمی‌شود (مسیر خرده‌فروشی)", async () => {
    resetRateLimits();
    const admin = await login("admin");
    const result = await call("try-on/tasks", {
      method: "POST",
      body: { fileId: "f", garmentId: "g" },
      token: admin.token,
    });
    expect(result.status).toBe(401);
  });
});
