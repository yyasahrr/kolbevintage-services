import { Link } from "../router";
import Icon from "./Icon";
import HeroCountdown from "./HeroCountdown";
import type { HeroStudioConfig } from "../siteSettings";

/* چهار تمپلیت هیروی استودیو - همه از یک پیکربندی تغذیه میشوند:
   ۱) تمامصفحه کلاسیک   ۲) اسپلیت ادیتوریال   ۳) بنر عریض کمارتفاع   ۴) پوستر تایپوگرافیک */

type TemplateProps = { config: HeroStudioConfig; preview?: boolean };

function Cta({ config }: TemplateProps) {
  if (!config.ctaLabel) return null;
  return (
    <Link
      to={config.ctaTo || "/shop"}
      className="hero-cta inline-flex min-h-11 items-center gap-2 rounded-full px-6 py-3 text-[12.5px] font-medium transition active:translate-y-px"
      style={{
        background: config.countdown.accent || "#011c3a",
        color: "#fff",
        ["--cta-hover-bg" as string]: config.buttonHoverBg,
        ["--cta-hover-text" as string]: config.buttonHoverText,
      }}
    >
      {config.ctaLabel}
      <Icon name="arrowLeft" className="h-4 w-4" />
    </Link>
  );
}

function Countdown({ config, size }: TemplateProps & { size?: "sm" | "md" | "lg" }) {
  return <HeroCountdown config={config.countdown} size={size} />;
}

/** ۱) تمامصفحه کلاسیک - تصویر تمامپهن، محتوا وسط، شمارنده زیر دکمه */
export function HeroTemplate1({ config }: TemplateProps) {
  return (
    <section className="relative flex min-h-[78svh] w-full items-center justify-center overflow-hidden">
      <img src={config.bgImage} alt={config.title} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" style={{ background: `rgba(7,20,34,${config.overlay})` }} />
      <div className="relative z-10 flex max-w-3xl flex-col items-center px-6 py-20 text-center text-white">
        {config.eyebrow ? <p className="text-[11px] tracking-[0.32em] text-white/80">{config.eyebrow}</p> : null}
        <h1 className="fade-up mt-4 text-[30px] font-medium leading-[1.4] sm:text-[40px] lg:text-[52px]" style={config.titleColor ? { color: config.titleColor } : undefined}>{config.title}</h1>
        {config.subtitle ? <p className="mt-4 max-w-xl text-[13px] leading-[2] text-white/85" style={config.subtitleColor ? { color: config.subtitleColor } : undefined}>{config.subtitle}</p> : null}
        <div className="mt-8 flex flex-col items-center gap-6">
          <Cta config={config} />
          <Countdown config={config} size="lg" />
        </div>
      </div>
    </section>
  );
}

/** ۲) اسپلیت ادیتوریال - متن راست روی سطح گرم، تصویر چپ تمامقد */
export function HeroTemplate2({ config }: TemplateProps) {
  const dark = config.dark;
  const shapeCls =
    config.imageShape === "circle" ? "aspect-square rounded-full p-6 lg:p-10" :
    config.imageShape === "rounded" ? "rounded-[2rem] p-3 lg:p-5" : "";
  const imgWrap = "relative overflow-hidden " + (config.imageShape === "circle" ? "aspect-square rounded-full" : config.imageShape === "rounded" ? "rounded-[2rem]" : "");
  return (
    <section className={"grid overflow-hidden lg:grid-cols-[1.05fr_1fr] " + (dark ? "bg-[#0a1622] text-white" : "bg-[#f7f5f0] text-[#011c3a]")}>
      <div className="flex items-center px-6 py-14 sm:px-12 lg:px-16">
        <div className="max-w-xl">
          {config.eyebrow ? <p className="text-[11px] tracking-[0.32em] text-[#c9654d]">{config.eyebrow}</p> : null}
          <h1 className="fade-up mt-4 text-[28px] font-medium leading-[1.45] sm:text-[36px] lg:text-[44px]" style={config.titleColor ? { color: config.titleColor } : undefined}>{config.title}</h1>
          {config.subtitle ? <p className={"mt-4 text-[13px] leading-[2] " + (dark ? "text-white/70" : "text-neutral-600")} style={config.subtitleColor ? { color: config.subtitleColor } : undefined}>{config.subtitle}</p> : null}
          <div className="mt-8"><Cta config={config} /></div>
          <div className="mt-8"><Countdown config={config} /></div>
        </div>
      </div>
      <div className={"flex items-center justify-center " + shapeCls}>
        <div className={imgWrap + " h-full w-full lg:h-[78%] lg:w-[86%]"}>
          <img src={config.bgImage} alt={config.title} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ background: `rgba(7,20,34,${Math.min(config.overlay, 0.5)})` }} />
        </div>
      </div>
    </section>
  );
}

/** ۳) بنر عریض کمارتفاع - متن پایینراست، شمارنده قرصی پایینچپ */
export function HeroTemplate3({ config }: TemplateProps) {
  return (
    <section className="relative flex min-h-[62svh] w-full items-end overflow-hidden">
      <img src={config.bgImage} alt={config.title} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t to-transparent" style={{ background: `linear-gradient(to top, rgba(7,20,34,${Math.min(config.overlay + 0.25, 0.9)}), rgba(7,20,34,${config.overlay * 0.4}))` }} />
      <div className="relative z-10 flex w-full flex-wrap items-end justify-between gap-8 px-6 pb-10 sm:px-10 lg:px-14 lg:pb-14">
        <div className="max-w-xl text-white">
          {config.eyebrow ? <p className="text-[11px] tracking-[0.3em] text-white/75">{config.eyebrow}</p> : null}
          <h1 className="fade-up mt-3 text-[26px] font-medium leading-[1.4] sm:text-[34px] lg:text-[42px]">{config.title}</h1>
          {config.subtitle ? <p className="mt-3 text-[12.5px] leading-[2] text-white/85">{config.subtitle}</p> : null}
          <div className="mt-6"><Cta config={config} /></div>
        </div>
        <Countdown config={config} />
      </div>
    </section>
  );
}

/** ۴) پوستر تایپوگرافیک - تیتر غولپیکر روی تصویر تیرهشده، شمارنده وسط */
export function HeroTemplate4({ config }: TemplateProps) {
  return (
    <section className="relative flex min-h-[82svh] w-full flex-col items-center justify-center overflow-hidden">
      <img src={config.bgImage} alt={config.title} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ background: `rgba(7,20,34,${Math.min(config.overlay + 0.15, 0.92)})` }} />
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center px-6 py-20 text-center text-white">
        {config.eyebrow ? (
          <p className="w-full border-y border-white/20 py-3 text-[11px] tracking-[0.42em] text-white/75">{config.eyebrow}</p>
        ) : null}
        <h1 className="fade-up mt-8 text-[40px] font-medium leading-[1.15] tracking-tight sm:text-[58px] lg:text-[84px]">{config.title}</h1>
        {config.subtitle ? <p className="mt-6 max-w-xl text-[13px] leading-[2] text-white/80">{config.subtitle}</p> : null}
        <div className="mt-10 flex flex-col items-center gap-7">
          <Countdown config={config} size="lg" />
          <Cta config={config} />
        </div>
      </div>
    </section>
  );
}


/** ۵) سه ویدیو — گرید موزاییکی با متن وسط */
export function HeroTemplate5({ config }: TemplateProps) {
  return (
    <section className="relative min-h-[80svh] w-full overflow-hidden">
      {/* گرید ۳تایی ویدیو */}
      <div className="absolute inset-0 grid grid-cols-3 gap-[3px]">
        {[config.video1, config.video2, config.video3].map((src, i) => (
          <div key={i} className="relative overflow-hidden bg-neutral-900">
            {src ? (
              <video
                src={src}
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: `brightness(${1 - config.overlay})` }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-neutral-800">
                <span className="text-[10px] text-white/30">Video {i + 1}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* پوشش تیره */}
      <div className="absolute inset-0" style={{ background: `rgba(7,20,34,${Math.min(config.overlay + 0.15, 0.85)})` }} />

      {/* محتوا وسط */}
      <div className="relative z-10 flex min-h-[80svh] flex-col items-center justify-center px-6 text-center text-white">
        {config.eyebrow ? (
          <p className="border-y border-white/20 py-2.5 text-[11px] tracking-[0.35em] text-white/75">{config.eyebrow}</p>
        ) : null}
        <h1 className="fade-up mt-6 text-[32px] font-medium leading-[1.3] sm:text-[44px] lg:text-[56px]" style={config.titleColor ? { color: config.titleColor } : undefined}>
          {config.title}
        </h1>
        {config.subtitle ? (
          <p className="mt-4 max-w-xl text-[13px] leading-[2] text-white/80" style={config.subtitleColor ? { color: config.subtitleColor } : undefined}>
            {config.subtitle}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col items-center gap-6">
          <Countdown config={config} size="lg" />
          <Cta config={config} />
        </div>
      </div>
    </section>
  );
}

export const HERO_TEMPLATES: Array<{ id: 1 | 2 | 3 | 4 | 5; name: string; description: string; Component: (props: TemplateProps) => React.ReactElement }> = [
  { id: 1, name: "تمام‌صفحه کلاسیک", description: "تصویر تمام‌قد، محتوای وسط‌چین و شمارنده بزرگ زیر دکمه", Component: HeroTemplate1 },
  { id: 2, name: "اسپلیت ادیتوریال", description: "متن روی سطح گرم راست، تصویر تمام‌قد چپ", Component: HeroTemplate2 },
  { id: 3, name: "بنر عریض کم‌ارتفاع", description: "بنر افقی با متن پایین و شمارنده کنار", Component: HeroTemplate3 },
  { id: 4, name: "پوستر تایپوگرافیک", description: "تیتر غول‌پیکر روی تصویر تیره و شمارنده وسط", Component: HeroTemplate4 },
  { id: 5, name: "سه ویدیو", description: "گرید موزاییکی ۳ ویدیو همزمان + متن و شمارنده وسط", Component: HeroTemplate5 },
];

export function HeroStudioRenderer({ config }: { config: HeroStudioConfig }) {
  const template = HERO_TEMPLATES.find((t) => t.id === config.template) ?? HERO_TEMPLATES[0];
  const Template = template.Component;
  return <Template config={config} />;
}
