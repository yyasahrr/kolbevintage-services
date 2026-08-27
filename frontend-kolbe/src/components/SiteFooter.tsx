import { useState } from "react";
import { Link } from "../router";
import { fa } from "../utils/format";
import Icon from "./Icon";
import { useSiteSettings } from "../siteSettings";

export default function SiteFooter() {
  const { footer, builder } = useSiteSettings();
  const socials = builder.footer.socials;
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <footer className="mx-2 mb-2 overflow-hidden rounded-[1.5rem] bg-[#011c3a] text-white sm:mx-3 sm:mb-3">
      {/* خبرنامه — تمیز و ساده */}
      {builder.footer.newsletterEnabled && (
        <div className="mx-auto max-w-[900px] px-5 py-10 text-center lg:px-8">
          <h3 className="text-[17px] font-medium">{footer.title}</h3>
          <p className="mx-auto mt-2 max-w-sm text-[11.5px] leading-relaxed text-white/60">{footer.description}</p>
          <form
            onSubmit={(e) => { e.preventDefault(); if (email.trim()) setSent(true); }}
            className="mx-auto mt-5 flex max-w-sm items-center gap-2"
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={footer.emailPlaceholder}
              className="h-11 flex-1 rounded-full border border-white/20 bg-white/5 px-5 text-[12px] outline-none placeholder:text-white/35 focus:border-white/40"
            />
            <button
              type="submit"
              className="flex h-11 shrink-0 items-center rounded-full bg-white px-5 text-[11.5px] font-medium text-[#011c3a] transition hover:bg-neutral-100"
            >
              عضویت
            </button>
          </form>
          {sent && <p className="mt-3 text-[11px] text-white/50">ممنون — خوش آمدید!</p>}
        </div>
      )}

      {/* لینکها — فقط دو ستون، خلوت */}
      <div className="mx-auto max-w-[900px] px-5 pb-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-white/10 pt-6">
          {[
            { label: "فروشگاه", to: "/shop" },
            { label: "خرید عمده", to: "/wholesale" },
            { label: "مجله", to: "/blog" },
            { label: "درباره ما", to: "/about" },
            { label: "تماس با ما", to: "/contact" },
          ].map(link => (
            <Link key={link.label} to={link.to} className="text-[11.5px] text-white/70 transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </div>

        {/* اطلاعات تماس — یک خط */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10.5px] text-white/45">
          <span className="flex items-center gap-1.5"><Icon name="pin" className="h-3 w-3" /> {footer.address}</span>
          <span className="flex items-center gap-1.5 num-fa"><Icon name="phone" className="h-3 w-3" /> {footer.phone}</span>
          <span className="flex items-center gap-1.5"><Icon name="clock" className="h-3 w-3" /> {footer.hours}</span>
        </div>

        {/* سوشال — ساده */}
        <div className="mt-4 flex items-center justify-center gap-3">
          {socials.map((social, i) => (
            <a key={i} href={social.url} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/60 transition hover:border-white hover:text-white">
              <Icon name={social.icon} className="h-3.5 w-3.5" />
            </a>
          ))}
        </div>
      </div>

      {/* کپی‌رایت — یک خط */}
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-3 text-[10px] text-white/35">
          <span className="num-fa">© کلبه وینتیج {fa("۱۴۰۵")}</span>
          <span>·</span>
          <Link to="/about" className="transition hover:text-white/60">قوانین</Link>
          <Link to="/about" className="transition hover:text-white/60">حریم خصوصی</Link>
        </div>
      </div>
    </footer>
  );
}
