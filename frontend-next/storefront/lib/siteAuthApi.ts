/** Thin Retail adapter over the canonical shared cookie session boundary. */
import { ApiError } from "../../shared/http/errors";
import { canonicalClient } from "../../shared/http/clients";
import { createSessionClient } from "../../shared/session/auth-client";
import type { Session } from "../../shared/session/types";
import type { CustomerIdentity } from "../customerIdentity";

const sessionClient = createSessionClient(canonicalClient());

function retailIdentity(session: Session): CustomerIdentity | null {
  if (session.status !== "authenticated") return null;
  if (session.user.role !== "customer" && session.user.role !== "vip") {
    throw new ApiError({ kind: "FORBIDDEN", status: 403, code: "RETAIL_ROLE_REQUIRED", message: "این حساب دسترسی خریدار کلبه را ندارد." });
  }
  return {
    id: session.user.id,
    name: session.user.name ?? session.user.email?.split("@")[0] ?? "مشتری کلبه",
    phone: session.user.phone ?? "",
    ...(session.user.email ? { email: session.user.email } : {}),
  };
}

export async function restoreSiteCustomer(): Promise<CustomerIdentity | null> {
  return retailIdentity(await sessionClient.restore());
}

export async function signInSiteCustomer(email: string, password: string): Promise<CustomerIdentity> {
  const identity = retailIdentity(await sessionClient.login({ email: email.trim(), password }));
  if (!identity) throw new ApiError({ kind: "MALFORMED_RESPONSE", code: "SESSION_NOT_ESTABLISHED", message: "نشست خریدار پس از ورود تأیید نشد." });
  return identity;
}

export async function signUpSiteCustomer(input: { name: string; phone: string; email: string; password: string }): Promise<CustomerIdentity> {
  await registerSiteCustomer(input);
  const identity = await restoreSiteCustomer();
  if (!identity) throw new ApiError({ kind: "MALFORMED_RESPONSE", code: "SESSION_NOT_ESTABLISHED", message: "نشست خریدار پس از ثبت‌نام تأیید نشد." });
  return identity;
}

export async function registerSiteCustomer(input: { name: string; phone: string; email: string; password: string }): Promise<void> {
  const result = await canonicalClient().requestResult("/auth/register", {
    method: "POST",
    body: { email: input.email.trim(), password: input.password, name: input.name.trim(), phone: input.phone.trim(), role: "customer" },
  });
  if (!result.ok) throw result.error;
}

export async function signOutSiteCustomer(): Promise<void> {
  await sessionClient.logout();
}
