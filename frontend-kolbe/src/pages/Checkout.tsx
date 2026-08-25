import { useState } from "react";
import { Link } from "../router";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import Icon from "../components/Icon";
import { api, ApiError } from "../lib/medusa";

const provinces = [
  "تهران", "البرز", "اصفهان", "فارس", "خراسان رضوی", "آذربایجان شرقی", "آذربایجان غربی",
  "گیلان", "مازندران", "کرمان", "خوزستان", "قم", "یزد", "کرمانشاه", "هرمزگان", "سایر استان‌ها",
];

const shippingMethods = [
  { id: "post", label: "پست عادی", time: "۵ تا ۷ روز کاری", price: 59_000 },
  { id: "pishtaz", label: "پست پیشتاز", time: "۲ تا ۳ روز کاری", price: 89_000 },
  { id: "tipax", label: "تیپاکس", time: "۱ تا ۲ روز کاری", price: 145_000 },
];

const payMethods = [
  { id: "gateway", label: "درگاه بانکی", note: "پرداخت آنلاین امن" },
  { id: "installment", label: "پرداخت اقساطی", note: "۴ قسط بدون بهره" },
  { id: "cod", label: "پرداخت در محل", note: "فقط تهران و کرج" },
  { id: "wallet", label: "کیف پول کلبه", note: "موجودی: ۰ تومان" },
];

function Step({
  n,
  title,
  open,
  done,
  onOpen,
  children,
}: {
  n: number;
  title: string;
  open: boolean;
  done: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-neutral-200">
      <button onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-right">
        <span
          className={
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] " +
            (done || open ? "bg-[#011c3a] text-white" : "bg-neutral-200 text-neutral-500")
          }
        >
          {done ? <Icon name="check" className="h-3 w-3" strokeWidth={3} /> : fa(n)}
        </span>
        <span className="text-[13.5px] font-medium">{title}</span>
        <Icon name={open ? "minus" : "plus"} className="mr-auto h-3.5 w-3.5 text-neutral-400" />
      </button>
      {open && <div className="pb-6 pr-9">{children}</div>}
    </div>
  );
}

const input =
  "h-10 w-full rounded-[3px] border border-neutral-300 px-3 text-[12.5px] outline-none transition focus:border-[#011c3a]";

export default function Checkout() {
  const { lines, cartTotal, clearCart } = useStore();
  const [step, setStep] = useState(1);
  const [ship, setShip] = useState("pishtaz");
  const [pay, setPay] = useState("gateway");
  const [done, setDone] = useState(false);
  const [orderCode, setOrderCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [form, setForm] = useState({
    name: "", family: "", phone: "", email: "",
    province: "تهران", city: "", postal: "", address: "", plaque: "", unit: "", note: "",
  });

  const shipPrice = pay === "cod" ? 0 : shippingMethods.find((m) => m.id === ship)!.price;
  const total = cartTotal + (cartTotal >= 3_000_000 ? 0 : shipPrice);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (done) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 px-4 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#011c3a] text-white">
          <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
        </div>
        <h1 className="text-[22px] font-medium">سفارش شما ثبت شد</h1>
        <p className="text-[12.5px] leading-relaxed text-neutral-600">
          کد پیگیری: <span className="font-medium num-fa">{orderCode}</span>
          <br />
          جزئیات سفارش به شماره {form.phone || "ثبت‌شده"} پیامک شد.
        </p>
        <Link to="/shop" className="rounded-[3px] bg-[#011c3a] px-8 py-3 text-[13px] font-medium text-white">
          ادامه خرید
        </Link>
      </main>
    );
  }

  if (lines.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 px-4 py-24 text-center">
        <h1 className="text-[20px] font-medium">سبد خرید خالی است</h1>
        <Link to="/shop" className="rounded-[3px] bg-[#011c3a] px-8 py-3 text-[13px] text-white">
          مشاهده محصولات
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full px-4 py-10 lg:px-8 lg:py-14">
      <h1 className="mb-8 text-[24px] font-medium">تکمیل سفارش</h1>

      <div className="grid gap-10 lg:grid-cols-[1fr_340px] lg:gap-14">
        <div>
          <Step n={1} title="ورود / ثبت‌نام" open={step === 1} done={step > 1} onOpen={() => setStep(1)}>
            <p className="mb-4 text-[11.5px] leading-relaxed text-neutral-500">
              برای ثبت سفارش باید وارد حساب کاربری خود شوید.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input className={input} placeholder="نام" value={form.name} onChange={(e) => set("name", e.target.value)} />
              <input className={input} placeholder="نام خانوادگی" value={form.family} onChange={(e) => set("family", e.target.value)} />
              <input className={input} placeholder="شماره موبایل" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              <input className={input} placeholder="ایمیل (اختیاری)" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <button
              onClick={() => setStep(2)}
              className="mt-4 h-10 rounded-[3px] bg-[#011c3a] px-8 text-[12.5px] font-medium text-white"
            >
              ادامه
            </button>
          </Step>

          <Step n={2} title="آدرس تحویل" open={step === 2} done={step > 2} onOpen={() => setStep(2)}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <select className={input} value={form.province} onChange={(e) => set("province", e.target.value)}>
                {provinces.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <input className={input} placeholder="شهر" value={form.city} onChange={(e) => set("city", e.target.value)} />
              <input className={input + " sm:col-span-2"} placeholder="نشانی کامل" value={form.address} onChange={(e) => set("address", e.target.value)} />
              <input className={input} placeholder="پلاک" value={form.plaque} onChange={(e) => set("plaque", e.target.value)} />
              <input className={input} placeholder="واحد" value={form.unit} onChange={(e) => set("unit", e.target.value)} />
              <input className={input} placeholder="کد پستی (۱۰ رقم)" inputMode="numeric" value={form.postal} onChange={(e) => set("postal", e.target.value.replace(/\D/g, "").slice(0, 10))} />
              <input className={input} placeholder="توضیحات تحویل (اختیاری)" value={form.note} onChange={(e) => set("note", e.target.value)} />
            </div>
            <button onClick={() => setStep(3)} className="mt-4 h-10 rounded-[3px] bg-[#011c3a] px-8 text-[12.5px] font-medium text-white">
              ادامه
            </button>
          </Step>

          <Step n={3} title="روش ارسال" open={step === 3} done={step > 3} onOpen={() => setStep(3)}>
            <div className="space-y-2">
              {shippingMethods.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setShip(m.id)}
                  className={
                    "flex w-full items-center gap-3 rounded-[3px] border p-3 text-right transition " +
                    (ship === m.id ? "border-[#011c3a] bg-[#f7f6f3]" : "border-neutral-300 hover:border-neutral-400")
                  }
                >
                  <span className={"h-4 w-4 shrink-0 rounded-full border-4 " + (ship === m.id ? "border-[#011c3a]" : "border-neutral-300")} />
                  <span className="flex-1">
                    <span className="block text-[12.5px] font-medium">{m.label}</span>
                    <span className="block text-[11px] text-neutral-500">{m.time}</span>
                  </span>
                  <span className="text-[12px] num-fa">{toman(m.price)}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(4)} className="mt-4 h-10 rounded-[3px] bg-[#011c3a] px-8 text-[12.5px] font-medium text-white">
              ادامه
            </button>
          </Step>

          <Step n={4} title="روش پرداخت" open={step === 4} done={false} onOpen={() => setStep(4)}>
            <div className="grid gap-2 sm:grid-cols-2">
              {payMethods.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setPay(m.id)}
                  className={
                    "rounded-[3px] border p-3 text-right transition " +
                    (pay === m.id ? "border-[#011c3a] bg-[#f7f6f3]" : "border-neutral-300 hover:border-neutral-400")
                  }
                >
                  <span className="block text-[12.5px] font-medium">{m.label}</span>
                  <span className="mt-0.5 block text-[11px] text-neutral-500">{m.note}</span>
                </button>
              ))}
            </div>
            <button
              onClick={async () => {
                if (!form.name.trim() || !form.phone.trim()) {
                  setOrderError("نام و شماره موبایل برای ثبت سفارش لازم است.");
                  setStep(1);
                  return;
                }
                setSubmitting(true);
                setOrderError("");
                try {
                  const result = await api<{ orderCode: string }>("/store/kolbe/retail/orders", {
                    method: "POST",
                    body: {
                      customer: { name: `${form.name} ${form.family}`.trim(), phone: form.phone, email: form.email },
                      lines: lines.map((l) => ({ id: l.id, name: l.name, colour: l.colour, size: l.size, price: l.price, qty: l.qty, img: l.img })),
                      address: {
                        province: form.province, city: form.city, address: form.address,
                        plaque: form.plaque, unit: form.unit, postal: form.postal, note: form.note,
                      },
                      shipping: shippingMethods.find((m) => m.id === ship),
                      payMethod: pay,
                      totals: { items: cartTotal, shipping: total - cartTotal, total },
                    },
                  });
                  setOrderCode(result.orderCode);
                  clearCart();
                  setDone(true);
                } catch (error) {
                  if (error instanceof ApiError && error.code === "NETWORK") {
                    setOrderError("اتصال به سرور برقرار نشد؛ لطفاً دوباره تلاش کنید.");
                  } else {
                    setOrderError("ثبت سفارش انجام نشد؛ اطلاعات را بررسی و دوباره تلاش کنید.");
                  }
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting}
              className="mt-5 h-11 w-full rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "در حال ثبت سفارش…" : "پرداخت و ثبت نهایی سفارش"}
            </button>
            {orderError ? (
              <p role="alert" className="mt-3 rounded-[3px] border border-red-200 bg-red-50 px-3 py-2.5 text-[11.5px] text-red-700">
                {orderError}
              </p>
            ) : null}
          </Step>
        </div>

        <aside className="self-start lg:sticky lg:top-[124px]">
          <div className="liquid-panel rounded-[3px] border border-neutral-200 p-5">
            <h2 className="text-[14px] font-medium">خلاصه سفارش</h2>
            <div className="mt-4 max-h-64 space-y-3 overflow-y-auto border-b border-neutral-200 pb-4">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-3">
                  <img src={l.img} alt="" className="h-16 w-12 shrink-0 object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px]">{l.name}</p>
                    <p className="mt-0.5 text-[10.5px] text-neutral-500">
                      {l.colour} — {l.size} — {fa(l.qty)} عدد
                    </p>
                  </div>
                  <span className="shrink-0 text-[11.5px] num-fa">{toman(l.price * l.qty)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2 py-4 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-neutral-600">جمع کالاها</span>
                <span className="num-fa">{toman(cartTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">ارسال</span>
                <span className="num-fa">{cartTotal >= 3_000_000 ? "رایگان" : toman(shipPrice)}</span>
              </div>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-4 text-[14px] font-medium">
              <span>قابل پرداخت</span>
              <span className="num-fa">{toman(total)}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
