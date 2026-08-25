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
    <footer className="site-footer mx-2 mb-2 overflow-hidden rounded-[1.75rem] bg-[#011c3a] text-white sm:mx-3 sm:mb-3">
      {socials.length > 0 && (
        <div className="border-b border-white/10 px-5 py-3">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-center gap-2 lg:px-3">
            {socials.map((social, i) => (
              <a key={i} href={social.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-1.5 text-[10.5px] text-white/80 transition hover:border-white hover:text-white">
                <Icon name={social.icon} className="h-3.5 w-3.5" />
                {social.label}
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="site-footer__divider border-b border-white/12">
        <div className="mx-auto grid w-full max-w-[1240px] gap-5 px-5 py-7 md:grid-cols-[1fr_0.9fr] md:items-center lg:px-8">
          <div>
            <h3 className="text-[19px] font-medium">{footer.title}</h3>
            <p className="site-footer__muted mt-2 max-w-md text-[12px] leading-relaxed text-white/70">
              {footer.description}
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) setSent(true);
            }}
            className={builder.footer.newsletterEnabled ? "self-center" : "hidden"}
          >
            <div className="site-footer__input-row flex max-w-md items-center border-b border-white/40 pb-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={footer.emailPlaceholder}
                className="site-footer__input w-full bg-transparent text-[12.5px] outline-none placeholder:text-white/45"
              />
              <button
                type="submit"
                className="site-footer__submit flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                aria-label="عضویت"
              >
                <Icon name="arrowLeft" className="h-3.5 w-3.5" />
              </button>
            </div>
            {sent && <p className="site-footer__muted mt-2 text-[11.5px] text-white/70">ممنون — خوش آمدید!</p>}
          </form>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-5 py-8 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
          {footer.columns.map((c) => (
            <div key={c.title}>
              <h4 className="mb-3 text-[12px] font-semibold">{c.title}</h4>
              <ul className="space-y-[5px]">
                {c.items.slice(0, 4).map((i) => (
                  <li key={i}>
                    <Link to="/shop" className="site-footer__link text-[11.5px] text-white/70 hover:text-white hover:underline">
                      {i}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h4 className="mb-3 text-[12px] font-semibold">تماس با ما</h4>
            <ul className="site-footer__muted space-y-2 text-[11.5px] text-white/70">
              <li className="flex items-start gap-2">
                <Icon name="pin" className="mt-[2px] h-3.5 w-3.5 shrink-0" />
                {footer.address}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                <span className="num-fa">{footer.phone}</span>
              </li>
              <li className="flex items-center gap-2">
                <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                {footer.hours}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                {footer.email}
              </li>
            </ul>

            <div className="mt-4 flex gap-2">
              {["◎", "▶", "in"].map((s, i) => (
                <a
                  key={i}
                  href="https://instagram.com"
                  target="_blank"
                  rel="noreferrer"
                  className="site-footer__social flex h-7 w-7 items-center justify-center rounded-full border border-white/30 text-[11px] hover:bg-white/10"
                >
                  {s}
                </a>
              ))}
            </div>
          </div>
        </div>

      </div>

      <div className="site-footer__divider border-t border-white/12">
        <div className="site-footer__legal mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-[10.5px] text-white/55 lg:px-8">
          <span className="num-fa">© کلبه وینتیج {fa("۱۴۰۵")} — تمامی حقوق محفوظ است</span>
          {["قوانین", "حریم خصوصی", "مرجوعی"].map((t) => (
            <Link key={t} to="/about" className="site-footer__link hover:text-white hover:underline">
              {t}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
