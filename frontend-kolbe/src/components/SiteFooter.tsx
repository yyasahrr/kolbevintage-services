import { Link } from "../router";
import { fa } from "../utils/format";
import Icon from "./Icon";
import { useSiteSettings } from "../siteSettings";
import { useStorefrontTheme } from "../theme";

export default function SiteFooter() {
  const { footer, builder } = useSiteSettings();
  const socials = builder.footer.socials;
  const theme = useStorefrontTheme();
  const dark = theme === "dark";

  /* رنگها بر اساس تم */
  const bg = dark ? "bg-[#0a1622]" : "bg-[#f2f0eb]";
  const border = dark ? "border-white/10" : "border-[#011c3a]/10";
  const text = dark ? "text-white" : "text-[#011c3a]";
  const textMuted = dark ? "text-white/55" : "text-[#011c3a]/55";
  const textFaint = dark ? "text-white/35" : "text-[#011c3a]/35";
  const linkHover = dark ? "hover:text-white" : "hover:text-[#011c3a]";
  const socialBorder = dark ? "border-white/20 hover:border-white" : "border-[#011c3a]/20 hover:border-[#011c3a]";
  const licenseBg = dark ? "bg-white/5 border-white/15" : "bg-white border-[#011c3a]/10";

  return (
    <footer className={`mx-2 mb-2 overflow-hidden rounded-[1.5rem] ${bg} ${text} transition-colors duration-300 sm:mx-3 sm:mb-3`}>
      <div className="mx-auto max-w-[1000px] px-5 lg:px-8">

        {/* لوگو */}
        <div className={`flex flex-col items-center border-b ${border} py-8`}>
          <span className="text-[20px] font-semibold tracking-[0.12em]">کلبه وینتیج</span>
          <span className={`mt-1 text-[8px] tracking-[0.35em] ${textFaint}`}>KOLBE VINTAGE</span>
        </div>

        {/* دو ستون: دسترسی سریع + پشتیبانی */}
        <div className={`grid gap-8 py-8 sm:grid-cols-2 lg:grid-cols-4`}>

          {/* دسترسی سریع */}
          <div>
            <h4 className={`mb-3 text-[11px] font-semibold ${text}`}>دسترسی سریع</h4>
            <ul className="space-y-2">
              {[
                { label: "فروشگاه", to: "/shop" },
                { label: "خرید عمده", to: "/wholesale" },
                { label: "مجله", to: "/blog" },
                { label: "استایل‌ها", to: "/styles" },
                { label: "درباره ما", to: "/about" },
              ].map(link => (
                <li key={link.label}>
                  <Link to={link.to} className={`text-[11px] ${textMuted} transition ${linkHover}`}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* پشتیبانی */}
          <div>
            <h4 className={`mb-3 text-[11px] font-semibold ${text}`}>پشتیبانی</h4>
            <ul className="space-y-2">
              {[
                { label: "تماس با ما", to: "/contact" },
                { label: "پیگیری سفارش", to: "/account" },
                { label: "قوانین و مقررات", to: "/about" },
                { label: "حریم خصوصی", to: "/about" },
                { label: "مرجوعی و تعویض", to: "/about" },
              ].map(link => (
                <li key={link.label}>
                  <Link to={link.to} className={`text-[11px] ${textMuted} transition ${linkHover}`}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* اطلاعات تماس */}
          <div>
            <h4 className={`mb-3 text-[11px] font-semibold ${text}`}>اطلاعات تماس</h4>
            <ul className={`space-y-2 text-[10.5px] ${textMuted}`}>
              <li className="flex items-start gap-2">
                <Icon name="pin" className={`mt-[2px] h-3.5 w-3.5 shrink-0 ${textFaint}`} />
                {footer.address}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="phone" className={`h-3.5 w-3.5 shrink-0 ${textFaint}`} />
                <span className="num-fa">{footer.phone}</span>
              </li>
              <li className="flex items-center gap-2">
                <Icon name="clock" className={`h-3.5 w-3.5 shrink-0 ${textFaint}`} />
                {footer.hours}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="mail" className={`h-3.5 w-3.5 shrink-0 ${textFaint}`} />
                {footer.email}
              </li>
            </ul>

            {/* سوشال */}
            <div className="mt-4 flex gap-2">
              {socials.map((social, i) => (
                <a key={i} href={social.url} target="_blank" rel="noreferrer" className={`flex h-8 w-8 items-center justify-center rounded-full border ${socialBorder} ${textMuted} transition`}>
                  <Icon name={social.icon} className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </div>

          {/* مجوزها */}
          <div>
            <h4 className={`mb-3 text-[11px] font-semibold ${text}`}>مجوزها</h4>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "نماد اعتماد", sub: "اینماد" },
                { label: "ساماندهی", sub: "رسانه‌های دیجیتال" },
                { label: "اتحادیه", sub: "کسب و کار مجازی" },
              ].map(license => (
                <div key={license.label} className={`flex h-16 w-16 flex-col items-center justify-center rounded-lg border ${licenseBg}`}>
                  <Icon name="shield" className={`h-5 w-5 ${textFaint}`} strokeWidth={1.2} />
                  <span className={`mt-1 text-[7.5px] leading-tight ${textFaint}`}>{license.label}</span>
                  <span className={`text-[6.5px] leading-tight ${textFaint}`}>{license.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* کپی‌رایت */}
      <div className={`border-t ${border}`}>
        <div className={`mx-auto flex max-w-[1000px] flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-3 text-[10px] ${textFaint}`}>
          <span className="num-fa">© کلبه وینتیج {fa("۱۴۰۵")} — تمامی حقوق محفوظ است</span>
        </div>
      </div>
    </footer>
  );
}
