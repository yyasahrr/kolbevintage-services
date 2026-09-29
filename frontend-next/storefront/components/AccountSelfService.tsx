import { useEffect, useState } from "react";
import { api, loadToken } from "../lib/api";
import { toman } from "../utils/format";

const input = "h-10 w-full rounded-[3px] border border-neutral-300 px-3 text-[12.5px]";

function token() {
  return loadToken("customer");
}

export function AccountOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ orders: any[] }>("/store/kolbe/account/orders", { token: token() }).then((result) => setOrders(result.orders)).catch(() => setError("سفارش‌های واقعی خوانده نشد."));
  }, []);
  if (error) return <p className="text-[12px] text-red-700">{error}</p>;
  if (!orders.length) return <p className="text-[12px] text-neutral-500">هنوز سفارش ثبت‌شده‌ای برای این حساب نیست.</p>;
  return <div className="space-y-3">{orders.map((order) => (
    <div key={order.order_code} className="rounded-[3px] border p-4 text-[12px]">
      <p>سفارش {order.order_code}</p>
      <p className="mt-1 text-neutral-500">{order.payment_status} · {toman(Number(order.total_amount))}</p>
    </div>
  ))}</div>;
}

export function AccountProfile() {
  const [form, setForm] = useState({ name: "", familyName: "", birthDate: "", city: "", address: "", email: "", phone: "", code: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<any>("/store/kolbe/account/profile", { token: token() }).then((profile) => setForm((current) => ({
      ...current,
      name: profile.display_name || "",
      familyName: profile.family_name || "",
      birthDate: profile.birth_date ? String(profile.birth_date).slice(0, 10) : "",
      city: profile.city || "",
      address: profile.address || "",
      email: profile.email || "",
      phone: profile.phone || "",
    }))).catch(() => setError("پرونده حساب خوانده نشد."));
  }, []);
  return <div className="grid max-w-lg gap-2.5">
    {error && <p className="text-[12px] text-red-700">{error}</p>}
    {notice && <p className="text-[12px] text-[#36563a]">{notice}</p>}
    <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="نام" />
    <input className={input} value={form.familyName} onChange={(e) => setForm({ ...form, familyName: e.target.value })} placeholder="نام خانوادگی" />
    <input className={input} value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} placeholder="تاریخ تولد" />
    <input className={input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="شهر" />
    <input className={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="نشانی" />
    <button className="h-10 bg-[#011c3a] text-[12.5px] text-white" onClick={async () => {
      await api("/store/kolbe/account/profile", { method: "POST", token: token(), body: { name: form.name, familyName: form.familyName, birthDate: form.birthDate || null, city: form.city, address: form.address } });
      setNotice("نام و نشانی ذخیره شد. تغییر موبایل و ایمیل فقط با تأیید انجام می‌شود.");
    }}>ذخیره نام و نشانی</button>
    <input className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ایمیل جدید" />
    <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="موبایل جدید" />
    <input className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="کد تأیید" />
    <div className="flex gap-2">
      <button className="h-10 border px-3 text-[12px]" onClick={async () => { await api("/store/kolbe/account/profile/email", { method: "POST", token: token(), body: { email: form.email } }); setNotice("کد تغییر ایمیل در صف ارسال است."); }}>درخواست تأیید ایمیل</button>
      <button className="h-10 border px-3 text-[12px]" onClick={async () => { await api("/store/kolbe/account/profile/phone", { method: "POST", token: token(), body: { phone: form.phone } }); setNotice("کد تغییر موبایل در صف ارسال است."); }}>درخواست تأیید موبایل</button>
    </div>
    <button className="h-10 border px-3 text-[12px]" onClick={async () => { await api("/store/kolbe/account/profile/email/confirm", { method: "POST", token: token(), body: { code: form.code } }); setNotice("ایمیل پس از تأیید عوض شد."); }}>تأیید ایمیل با کد</button>
  </div>;
}

export function AccountAddresses() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ city: "", address: "" });
  const load = () => api<{ addresses: any[] }>("/store/kolbe/account/addresses", { token: token() }).then((result) => setItems(result.addresses));
  useEffect(() => { void load(); }, []);
  return <div className="space-y-3">
    {items.map((item) => <div key={item.id} className="border p-3 text-[12px]">{item.city} — {item.address}</div>)}
    <input className={input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="شهر" />
    <input className={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="نشانی" />
    <button className="h-10 bg-[#011c3a] px-4 text-[12px] text-white" onClick={async () => { await api("/store/kolbe/account/addresses", { method: "POST", token: token(), body: form }); setForm({ city: "", address: "" }); await load(); }}>افزودن آدرس</button>
  </div>;
}

export function AccountSecurity() {
  const [data, setData] = useState<any>(null);
  const [password, setPassword] = useState({ currentPassword: "", password: "" });
  const [notice, setNotice] = useState("");
  useEffect(() => { api("/store/kolbe/account/security", { token: token() }).then(setData).catch(() => setData(null)); }, []);
  return <div className="max-w-lg space-y-3 text-[12px]">
    <p>روش‌های ورود دومرحله‌ای: رمز یکبارمصرف و اپلیکیشن احراز. تا وقتی فعال نشده، ورود عادی قطع نمی‌شود.</p>
    {notice && <p className="text-[#36563a]">{notice}</p>}
    <input className={input} type="password" value={password.currentPassword} onChange={(e) => setPassword({ ...password, currentPassword: e.target.value })} placeholder="رمز فعلی" />
    <input className={input} type="password" value={password.password} onChange={(e) => setPassword({ ...password, password: e.target.value })} placeholder="رمز جدید" />
    <button className="h-10 bg-[#011c3a] px-4 text-white" onClick={async () => { await api("/store/kolbe/account/security/password", { method: "POST", token: token(), body: password }); setNotice("رمز عوض شد."); }}>تغییر رمز</button>
    <button className="block h-10 border px-4" onClick={async () => { await api("/store/kolbe/account/security/sessions/revoke", { method: "POST", token: token(), body: {} }); setNotice("همه نشست‌ها باطل شد. دوباره وارد شوید."); }}>خروج از همه دستگاه‌ها</button>
    <button className="block h-10 border px-4" onClick={async () => { const setup = await api<any>("/store/kolbe/account/security/totp", { method: "POST", token: token(), body: {} }); setNotice(`رمز اپلیکیشن ساخته شد: ${setup.secret}`); }}>آماده‌سازی احراز اپلیکیشن</button>
    <p className="text-neutral-500">نشست‌های فعال: {data?.sessions?.length ?? 0} · ورودهای اخیر: {data?.history?.length ?? 0}</p>
  </div>;
}
