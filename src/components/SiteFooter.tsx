import { useState } from "react";
import { Link } from "../router";
import { footerColumnsFa, styles } from "../siteData";
import { fa } from "../utils/format";
import Icon from "./Icon";

export default function SiteFooter() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <footer className="bg-[#011c3a] text-white">
      {/* خبرنامه */}
      <div className="border-b border-white/12">
        <div className="mx-auto grid w-full gap-8 px-4 py-12 lg:grid-cols-2 lg:gap-24 lg:px-8">
          <div>
            <h3 className="text-[19px] font-medium">به دنیای کلبه وینتیج بپیوندید</h3>
            <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-white/70">
              اولین نفری باشید که از کالکشن‌های جدید، رویدادها و پیشنهادهای ویژه باخبر می‌شود.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) setSent(true);
            }}
            className="self-center"
          >
            <div className="flex max-w-md items-center border-b border-white/40 pb-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="نشانی ایمیل خود را وارد کنید"
                className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-white/45"
              />
              <button
                type="submit"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[#011c3a]"
                aria-label="عضویت"
              >
                <Icon name="arrowLeft" className="h-3.5 w-3.5" />
              </button>
            </div>
            {sent && <p className="mt-2 text-[11.5px] text-white/70">ممنون — خوش آمدید!</p>}
          </form>
        </div>
      </div>

      <div className="mx-auto w-full px-4 py-14 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {footerColumnsFa.map((c) => (
            <div key={c.title}>
              <h4 className="mb-3 text-[12px] font-semibold">{c.title}</h4>
              <ul className="space-y-[6px]">
                {c.items.map((i) => (
                  <li key={i}>
                    <Link to="/shop" className="text-[11.5px] text-white/70 hover:text-white hover:underline">
                      {i}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h4 className="mb-3 text-[12px] font-semibold">تماس با ما</h4>
            <ul className="space-y-2 text-[11.5px] text-white/70">
              <li className="flex items-start gap-2">
                <Icon name="pin" className="mt-[2px] h-3.5 w-3.5 shrink-0" />
                تهران، خیابان ولیعصر، پلاک {fa("۱۲۴۰")}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                <span className="num-fa">{fa("۰۲۱-۹۱۰۰۲۲۳۳")}</span>
              </li>
              <li className="flex items-center gap-2">
                <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                شنبه تا پنجشنبه، {fa("۱۰")} تا {fa("۱۹")}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                hi@kolbevintage.ir
              </li>
            </ul>

            <div className="mt-5 flex gap-3">
              {["f", "◎", "▶", "in"].map((s, i) => (
                <a
                  key={i}
                  href="https://instagram.com"
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/30 text-[11px] hover:bg-white/10"
                >
                  {s}
                </a>
              ))}
            </div>
          </div>
        </div>

        <hr className="my-10 border-white/12" />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="text-[12px] font-semibold">خرید بر اساس استایل:</span>
          {styles.map((s) => (
            <Link
              key={s.slug}
              to={`/styles?s=${s.slug}`}
              className="rounded-[3px] border border-white/25 px-3 py-1 text-[11.5px] text-white/75 hover:border-white hover:text-white"
            >
              {s.name} <span className="text-white/40">/ {s.latin}</span>
            </Link>
          ))}
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/35 text-[9px]">
            نماد اعتماد
          </span>
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/35 text-[9px]">
            ساماندهی
          </span>
          <Link
            to="/wholesale"
            className="rounded-[3px] border border-white/30 px-4 py-2 text-[11.5px] hover:bg-white/10"
          >
            فروش عمده و همکاری
          </Link>
          <div className="mr-auto flex items-center gap-2 text-[11.5px] text-white/70">
            <span className="text-[#f0c04a]">★★★★★</span>
            <span className="num-fa">امتیاز {fa("۴.۸")} از {fa("۲٬۳۱۴")} خرید</span>
          </div>
        </div>
      </div>

      <div className="border-t border-white/12">
        <div className="mx-auto flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 text-[10.5px] text-white/55 lg:px-8">
          <span className="num-fa">© کلبه وینتیج {fa("۱۴۰۵")} — تمامی حقوق محفوظ است</span>
          {["قوانین و مقررات", "حریم خصوصی", "شرایط مرجوعی", "سیاست کوکی"].map((t) => (
            <Link key={t} to="/about" className="hover:text-white hover:underline">
              {t}
            </Link>
          ))}
          <Link to="/admin" className="mr-auto hover:text-white hover:underline">
            پنل مدیریت
          </Link>
        </div>
      </div>
    </footer>
  );
}
