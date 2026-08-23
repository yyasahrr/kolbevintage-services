import { supabase } from "./supabase";
import type { CustomerIdentity } from "../customerIdentity";

function requireClient() { if (!supabase) throw new Error("اتصال حساب کاربری تنظیم نشده است."); return supabase; }

async function loadIdentity(userId: string, email?: string): Promise<CustomerIdentity> {
  const client = requireClient();
  const { data } = await client.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle();
  return { id: userId, name: data?.full_name || email?.split("@")[0] || "کاربر کلبه", phone: data?.phone || "—", email };
}

export async function restoreSiteCustomer() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? loadIdentity(data.session.user.id, data.session.user.email) : null;
}

export async function signInSiteCustomer(email: string, password: string) {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error("ایمیل یا رمز عبور درست نیست.");
  return loadIdentity(data.user.id, data.user.email);
}

export async function signUpSiteCustomer(input: { name: string; phone: string; email: string; password: string }) {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({ email: input.email.trim(), password: input.password, options: { data: { full_name: input.name.trim(), phone: input.phone.trim() } } });
  if (error) throw new Error(error.message.includes("already") ? "این ایمیل قبلاً ثبت شده است." : "ساخت حساب انجام نشد.");
  if (!data.user) throw new Error("ساخت حساب انجام نشد.");
  if (data.session) await client.from("profiles").update({ full_name: input.name.trim(), phone: input.phone.trim() }).eq("id", data.user.id);
  return loadIdentity(data.user.id, data.user.email);
}

export async function signOutSiteCustomer() { if (supabase) await supabase.auth.signOut(); }
