import { Link } from "../router";
import { fa } from "../utils/format";
import Icon from "./Icon";
import { useSiteSettings } from "../siteSettings";

export default function SiteFooter() {
  const { footer, builder } = useSiteSettings();
  const socials = builder.footer.socials;

  return (
    <footer className="mx-2 mb-2 overflow-hidden rounded-[1.5rem] bg-[#011c3a] text-white sm:mx-3 sm:mb-3">
      <div className="mx-auto max-w-[1000px] px-5 lg:px-8">

        {/* لوگو */}
        <div className="flex flex-col items-center border-b border-white/10 py-8">
          <span className="text-[20px] font-semibold tracking-[0.12em]">کلبه وینتیج</span>
          <span className="mt-1 text-[8px] tracking-[0.35em] text-white/40">KOLBE VINTAGE</span>
        </div>

        {/* دو ستون: دسترسی سریع + پشتیبانی */}
        <div className="grid gap-8 py-8 sm:grid-cols-2 lg:grid-cols-4">

          {/* دسترسی سریع */}
          <div>
            <h4 className="mb-3 text-[11px] font-semibold text-white/90">دسترسی سریع</h4>
            <ul className="space-y-2">
              {[
                { label: "فروشگاه", to: "/shop" },
                { label: "خرید عمده", to: "/wholesale" },
                { label: "مجله", to: "/blog" },
                { label: "استایل‌ها", to: "/styles" },
                { label: "درباره ما", to: "/about" },
              ].map(link => (
                <li key={link.label}>
                  <Link to={link.to} className="text-[11px] text-white/60 transition hover:text-white">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* پشتیبانی */}
          <div>
            <h4 className="mb-3 text-[11px] font-semibold text-white/90">پشتیبانی</h4>
            <ul className="space-y-2">
              {[
                { label: "تماس با ما", to: "/contact" },
                { label: "پیگیری سفارش", to: "/account" },
                { label: "قوانین و مقررات", to: "/about" },
                { label: "حریم خصوصی", to: "/about" },
                { label: "مرجوعی و تعویض", to: "/about" },
              ].map(link => (
                <li key={link.label}>
                  <Link to={link.to} className="text-[11px] text-white/60 transition hover:text-white">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* اطلاعات تماس */}
          <div>
            <h4 className="mb-3 text-[11px] font-semibold text-white/90">اطلاعات تماس</h4>
            <ul className="space-y-2 text-[10.5px] text-white/55">
              <li className="flex items-start gap-2">
                <Icon name="pin" className="mt-[2px] h-3.5 w-3.5 shrink-0 text-white/35" />
                {footer.address}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-white/35" />
                <span className="num-fa">{footer.phone}</span>
              </li>
              <li className="flex items-center gap-2">
                <Icon name="clock" className="h-3.5 w-3.5 shrink-0 text-white/35" />
                {footer.hours}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="mail" className="h-3.5 w-3.5 shrink-0 text-white/35" />
                {footer.email}
              </li>
            </ul>

            {/* سوشال */}
            <div className="mt-4 flex gap-2">
              {socials.map((social, i) => (
                <a key={i} href={social.url} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/50 transition hover:border-white hover:text-white">
                  <Icon name={social.icon} className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </div>

          {/* مجوزها */}
          <div>
            <h4 className="mb-3 text-[11px] font-semibold text-white/90">مجوزها</h4>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "نماد اعتماد", sub: "اینماد" },
                { label: "ساماندهی", sub: "رسانه‌های دیجیتال" },
                { label: "اتحادیه", sub: "کسب و کار مجازی" },
              ].map(license => (
                <div key={license.label} className="flex h-16 w-16 flex-col items-center justify-center rounded-lg border border-white/15 bg-white/5">
                  <Icon name="shield" className="h-5 w-5 text-white/40" strokeWidth={1.2} />
                  <span className="mt-1 text-[7.5px] leading-tight text-white/40">{license.label}</span>
                  <span className="text-[6.5px] leading-tight text-white/30">{license.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* کپی‌رایت */}
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-3 text-[10px] text-white/35">
          <span className="num-fa">© کلبه وینتیج {fa("۱۴۰۵")} — تمامی حقوق محفوظ است</span>
        </div>
      </div>
    </footer>
  );
}
