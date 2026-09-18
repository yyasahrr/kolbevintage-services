import { api, ApiError } from "./api";
import type { CustomerIdentity } from "../customerIdentity";

type LoginResponse = { user: { id: string; email: string; role: string; name: string | null; phone: string | null } };

async function identityFromMe(): Promise<CustomerIdentity | null> {
  try {
    const me = await api<{ id: string; name: string; phone: string; email?: string }>("/store/kolbe/me");
    return { id: me.id, name: me.name, phone: me.phone, email: me.email };
  } catch (error) {
    if (error instanceof ApiError && error.code === "NETWORK") return null;
    return null;
  }
}

export async function restoreSiteCustomer() {
  return identityFromMe();
}

export async function signInSiteCustomer(email: string, password: string) {
  const data = await api<LoginResponse>("/store/kolbe/auth/login", {
    method: "POST",
    body: { email, password },
  }).catch((error) => {
    if (error instanceof ApiError && (error.code === "NETWORK" || error.code === "BAD_API_KEY" || error.code.startsWith("HTTP_5"))) throw new Error("اتصال به بک‌اند برقرار نیست؛ اگر این پیام را می‌بینید احتمالاً روی پیش‌نمایش قدیمی هستید — از آخرین تب پیش‌نمایش استفاده کنید.");
    throw new Error("ایمیل یا رمز عبور درست نیست.");
  });
  // پس از ورود، کوکی HttpOnly ست شده؛ اطلاعات کاربر را از me می‌خوانیم
  const identity = await identityFromMe();
  if (identity) return identity;
  return { id: data.user.id, name: data.user.name ?? email.split("@")[0], phone: data.user.phone ?? "—", email: data.user.email } as CustomerIdentity;
}

export async function signUpSiteCustomer(input: { name: string; phone: string; email: string; password: string }) {
  await api("/store/kolbe/auth/register", {
    method: "POST",
    body: { email: input.email.trim(), password: input.password, name: input.name.trim(), phone: input.phone.trim(), role: "customer" },
  }).catch((error) => {
    if (error instanceof ApiError && (error.code === "NETWORK" || error.code === "INVALID_INPUT")) throw new Error("ساخت حساب انجام نشد؛ اطلاعات را بررسی کنید.");
    throw new Error("این ایمیل قبلاً ثبت شده است.");
  });
  return signInSiteCustomer(input.email, input.password);
}

export async function signOutSiteCustomer() {
  try {
    await api("/store/kolbe/auth/logout", { method: "POST" });
  } catch {
    // حتی اگر سرور در دسترس نباشد، خروج محلی انجام می‌شود
  }
}
