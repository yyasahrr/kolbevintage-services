import { useState } from "react";
import { Link } from "../router";
import { products } from "../data/catalog";
import { fa } from "../utils/format";
import Icon from "../components/Icon";

const benefits = [
  { icon: "needle", title: "دوخت اختصاصی", text: "امکان سفارش با برچسب و بسته‌بندی برند شما." },
  { icon: "truck", title: "ارسال سراسری", text: "ارسال رایگان سفارش‌های عمده به سراسر کشور." },
  { icon: "shield", title: "تسویه منعطف", text: "امکان تسویه چکی برای همکاران دائمی." },
  { icon: "return", title: "مرجوعی فصلی", text: "تعویض اقلام فروش‌نرفته در پایان هر فصل." },
];

const plans = [
  {
    id: "basic",
    name: "همکار",
    price: "رایگان",
    period: "",
    features: ["دسترسی به کاتالوگ عمده", "حداقل سفارش ۲۰ عدد", "تخفیف پایه ۲۵٪", "پشتیبانی ایمیلی"],
    highlight: false,
  },
  {
    id: "pro",
    name: "همکار حرفه‌ای",
    price: "۱۲٬۰۰۰٬۰۰۰",
    period: "سالانه",
    features: [
      "همه مزایای پلن همکار",
      "تخفیف ۳۵٪ روی کل کاتالوگ",
      "اولویت در کالکشن‌های محدود",
      "کارشناس فروش اختصاصی",
      "ارسال رایگان نامحدود",
    ],
    highlight: true,
  },
  {
    id: "vip",
    name: "وی‌آی‌پی",
    price: "۳۵٬۰۰۰٬۰۰۰",
    period: "سالانه",
    features: [
      "همه مزایای پلن حرفه‌ای",
      "تخفیف ۴۵٪ و قیمت‌گذاری اختصاصی",
      "دوخت با برچسب برند شما",
      "پیش‌نمایش کالکشن پیش از عرضه",
      "تسویه چکی تا ۹۰ روز",
      "بازدید حضوری از کارگاه",
    ],
    highlight: false,
  },
];

const input =
  "h-10 w-full rounded-[3px] border border-neutral-300 px-3 text-[12.5px] outline-none transition focus:border-[#011c3a]";

export default function Wholesale() {
  const [sent, setSent] = useState(false);
  const [plan, setPlan] = useState("pro");
  const [form, setForm] = useState({ name: "", phone: "", city: "", store: "", instagram: "", note: "" });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (sent) {
    return (
      <main className="min-h-screen bg-[#011c3a] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-5 px-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/40">
            <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <h1 className="text-[22px] font-medium">درخواست شما ثبت شد</h1>
          <p className="text-[12.5px] leading-[2] text-white/70">
            کد پیگیری: <span className="num-fa">WS-{fa(Math.floor(Math.random() * 90000) + 10000)}</span>
            <br />
            تیم فروش عمده کلبه وینتیج طی یک روز کاری با شما تماس می‌گیرد.
            <br />
            برای پیگیری سریع‌تر می‌توانید با شماره ۰۲۱-۹۱۰۰۲۲۳۳ داخلی ۲ تماس بگیرید.
          </p>
          <Link to="/" className="mt-2 rounded-[3px] bg-white px-8 py-3 text-[13px] font-medium text-[#011c3a]">
            بازگشت به سایت
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* هدر اختصاصی عمده‌فروشی */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex w-full items-center justify-between px-4 py-4 lg:px-8">
          <Link to="/" className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-[0.14em]">کلبه وینتیج</span>
            <span className="mt-1 text-[8px] tracking-[0.4em] text-neutral-400">WHOLESALE</span>
          </Link>
          <nav className="flex items-center gap-5 text-[12px]">
            <a href="#plans" className="hidden hover:underline sm:block">پلن‌ها</a>
            <a href="#catalog" className="hidden hover:underline sm:block">کاتالوگ</a>
            <a href="#form" className="rounded-[3px] bg-[#011c3a] px-4 py-2 text-white">
              ثبت درخواست
            </a>
            <Link to="/" className="text-neutral-500 hover:underline">فروشگاه</Link>
          </nav>
        </div>
      </header>

      {/* هیرو */}
      <section className="relative h-[62vh] min-h-[380px] w-full overflow-hidden">
        <img src="/images/store.jpg" alt="فروش عمده کلبه وینتیج" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/75">B2B</p>
          <h1 className="mt-4 text-[28px] font-medium lg:text-[40px]">فروش عمده کلبه وینتیج</h1>
          <p className="mx-auto mt-4 max-w-xl text-[13px] leading-[2] text-white/85">
            اگر فروشگاه پوشاک دارید یا قصد راه‌اندازی دارید، با شرایط ویژه همکاری کنید. قیمت‌ها پس از تأیید درخواست
            و در کاتالوگ اختصاصی در اختیار شما قرار می‌گیرد.
          </p>
          <a href="#form" className="mt-7 rounded-[3px] bg-white px-8 py-3 text-[13px] font-medium text-[#011c3a]">
            درخواست همکاری
          </a>
        </div>
      </section>

      {/* مزایا */}
      <section className="mx-auto w-full px-4 py-14 lg:px-8 lg:py-20">
        <h2 className="mb-10 text-center text-[22px] font-medium">چرا کلبه وینتیج؟</h2>
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {benefits.map((b) => (
            <div key={b.title} className="text-center">
              <Icon name={b.icon} className="mx-auto h-7 w-7" strokeWidth={1.2} />
              <h3 className="mt-3 text-[13px] font-medium">{b.title}</h3>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* پلن‌ها */}
      <section id="plans" className="bg-[#f6f6f4] py-14 lg:py-20">
        <div className="mx-auto w-full px-4 lg:px-8">
          <div className="mb-10 text-center">
            <h2 className="text-[22px] font-medium">پلن‌های عضویت</h2>
            <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-neutral-500">
              سطح همکاری خود را انتخاب کنید. هر پلن، تخفیف و خدمات متفاوتی دارد.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlan(p.id)}
                className={
                  "flex flex-col rounded-[3px] border bg-white p-6 text-right transition " +
                  (plan === p.id ? "border-[#011c3a] shadow-sm" : "border-neutral-200 hover:border-neutral-400")
                }
              >
                {p.highlight && (
                  <span className="mb-3 self-start rounded-[3px] bg-[#011c3a] px-2.5 py-1 text-[9.5px] text-white">
                    پیشنهاد ما
                  </span>
                )}
                <h3 className="text-[16px] font-medium">{p.name}</h3>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[22px] font-medium num-fa">{p.price}</span>
                  {p.period && <span className="text-[11.5px] text-neutral-500">تومان / {p.period}</span>}
                </div>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2 text-[12px] leading-relaxed text-neutral-600">
                      <Icon name="check" className="mt-[3px] h-3 w-3 shrink-0 text-[#011c3a]" strokeWidth={2.6} />
                      {f}
                    </li>
                  ))}
                </ul>
                <span
                  className={
                    "mt-6 flex h-10 items-center justify-center rounded-[3px] text-[12.5px] font-medium transition " +
                    (plan === p.id ? "bg-[#011c3a] text-white" : "border border-neutral-300")
                  }
                >
                  {plan === p.id ? "انتخاب شده" : "انتخاب این پلن"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* کاتالوگ بدون قیمت */}
      <section id="catalog" className="mx-auto w-full px-4 py-14 lg:px-8 lg:py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-medium">کاتالوگ محصولات</h2>
            <p className="mt-2 text-[12.5px] text-neutral-500">
              قیمت عمده پس از تأیید درخواست همکاری نمایش داده می‌شود.
            </p>
          </div>
          <button className="rounded-[3px] border border-[#011c3a] px-6 py-2.5 text-[12px] font-medium transition hover:bg-[#011c3a] hover:text-white">
            دانلود کاتالوگ PDF
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4">
          {products.map((p) => (
            <div key={p.id}>
              <div className="overflow-hidden bg-neutral-100">
                <img src={p.images[0]} alt={p.name} loading="lazy" className="aspect-[3/4] w-full object-cover" />
              </div>
              <div className="mt-2.5">
                <p className="text-[12.5px] font-medium">{p.name}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">کد: {p.specs.code}</p>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex gap-1">
                    {p.colours.slice(0, 5).map((c) => (
                      <span key={c.name} className="h-3 w-3 rounded-full border border-neutral-300" style={{ background: c.hex }} />
                    ))}
                  </div>
                  <span className="text-[10.5px] text-neutral-400">قیمت پس از تأیید</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* فرم */}
      <section id="form" className="bg-[#011c3a] py-14 text-white lg:py-20">
        <div className="mx-auto w-full max-w-2xl px-4 lg:px-8">
          <div className="mb-8 text-center">
            <h2 className="text-[22px] font-medium">ثبت درخواست همکاری</h2>
            <p className="mt-3 text-[12.5px] leading-relaxed text-white/70">
              فرم را پر کنید؛ تیم فروش طی یک روز کاری با شما تماس می‌گیرد.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <input required className={input + " bg-white text-[#011c3a]"} placeholder="نام و نام خانوادگی *" value={form.name} onChange={(e) => set("name", e.target.value)} />
            <input required className={input + " bg-white text-[#011c3a]"} placeholder="شماره تماس *" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            <input required className={input + " bg-white text-[#011c3a]"} placeholder="شهر *" value={form.city} onChange={(e) => set("city", e.target.value)} />
            <input required className={input + " bg-white text-[#011c3a]"} placeholder="نام فروشگاه *" value={form.store} onChange={(e) => set("store", e.target.value)} />
            <input className={input + " bg-white text-[#011c3a] sm:col-span-2"} placeholder="آدرس پیج اینستاگرام (در صورت وجود)" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} />
            <textarea
              rows={4}
              className="w-full rounded-[3px] border border-neutral-300 bg-white p-3 text-[12.5px] text-[#011c3a] outline-none sm:col-span-2"
              placeholder="توضیحات — حجم تقریبی سفارش، نوع محصولات مورد نظر و..."
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
            <div className="sm:col-span-2">
              <p className="mb-2 text-[11.5px] text-white/60">
                پلن انتخابی: {plans.find((p) => p.id === plan)!.name}
              </p>
              <button type="submit" className="h-11 w-full rounded-[3px] bg-white text-[13px] font-medium text-[#011c3a] transition hover:bg-neutral-100">
                ارسال درخواست
              </button>
            </div>
          </form>
        </div>
      </section>

      <footer className="border-t border-neutral-200 py-6 text-center">
        <p className="text-[11px] text-neutral-500">
          © کلبه وینتیج {fa("۱۴۰۵")} — واحد فروش عمده
        </p>
      </footer>
    </div>
  );
}
