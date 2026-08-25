import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useSiteSettings } from "../siteSettings";

export default function PromoPopup() {
  const { builder } = useSiteSettings();
  const config = builder.popup;
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!config.enabled) return;
    if (config.oncePerSession && sessionStorage.getItem("kv_promo_seen")) return;
    const t = setTimeout(() => setShow(true), Math.max(0, config.delaySec) * 1000);
    return () => clearTimeout(t);
  }, [config.enabled, config.delaySec, config.oncePerSession]);

  const close = () => {
    if (config.oncePerSession) sessionStorage.setItem("kv_promo_seen", "1");
    setShow(false);
  };

  if (!show || !config.enabled) return null;

  const positionCls =
    config.position === "bottom-right" ? "items-end justify-end p-4" :
    config.position === "bottom-left" ? "items-end justify-start p-4" :
    "items-center justify-center px-4";

  return (
    <div dir={config.direction} className={`fixed inset-0 z-[110] flex ${positionCls}`}>
      <div className="absolute inset-0 bg-black/45" onClick={close} />
      <div
        className="promo-dialog fade-up relative w-full max-w-2xl overflow-hidden rounded-[3px] shadow-2xl sm:grid sm:grid-cols-2"
        style={{
          background: config.bgImage ? `url(${config.bgImage}) center/cover` : config.bg,
          color: config.textColor,
        }}
      >
        {config.image ? (
          <img src={config.image} alt="" className="hidden h-full w-full object-cover sm:block" loading="lazy" />
        ) : null}
        <div className="p-7">
          <button onClick={close} aria-label="بستن" className="absolute left-3 top-3 opacity-50 transition hover:opacity-100">
            <Icon name="close" className="h-4 w-4" />
          </button>

          {done ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
              <p className="text-[14px] font-medium">کد تخفیف شما</p>
              <p className="rounded-[3px] border border-dashed px-5 py-2 text-[15px] font-medium tracking-widest" style={{ borderColor: config.textColor }}>
                {config.couponCode}
              </p>
              <p className="text-[11.5px] opacity-60">به ایمیل شما هم ارسال شد.</p>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center gap-3">
              <h3 className="text-[17px] font-medium leading-relaxed">{config.title}</h3>
              <p className="text-[12px] leading-relaxed opacity-75">{config.body}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) setDone(true);
                }}
                className="mt-1 flex gap-2"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={config.inputPlaceholder}
                  dir={config.direction === "ltr" ? "ltr" : "rtl"}
                  className="h-11 flex-1 rounded-[3px] border px-3 text-[12px] outline-none transition"
                  style={{ borderColor: config.textColor + "55", background: "transparent", color: "inherit" }}
                />
                <button type="submit" className="h-11 rounded-[3px] px-5 text-[12px] font-medium text-white transition active:translate-y-px" style={{ background: config.accent }}>
                  {config.ctaLabel}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
