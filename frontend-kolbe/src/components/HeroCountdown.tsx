import { useEffect, useMemo, useState } from "react";
import { fa } from "../utils/format";
import type { HeroStudioConfig } from "../siteSettings";

export type CountdownState = { days: number; hours: number; minutes: number; seconds: number; expired: boolean };

const PAD = (n: number) => fa(String(Math.max(0, n)).padStart(2, "0"));

/** شمارنده معکوس جشنواره - تا ثانیه بهروزرسانی میشود. */
export function useCountdown(targetISO: string): CountdownState | null {
  const target = useMemo(() => new Date(targetISO).getTime(), [targetISO]);
  const valid = Boolean(targetISO) && Number.isFinite(target);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [valid]);

  return useMemo(() => {
    if (!valid) return null;
    const diff = target - now;
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    return {
      days: Math.floor(diff / 86_400_000),
      hours: Math.floor(diff / 3_600_000) % 24,
      minutes: Math.floor(diff / 60_000) % 60,
      seconds: Math.floor(diff / 1_000) % 60,
      expired: false,
    };
  }, [valid, target, now]);
}

const STYLE_CLASSES: Record<HeroStudioConfig["countdown"]["style"], string> = {
  glass: "border border-white/30 bg-white/10 text-white backdrop-blur-md",
  dark: "border border-white/10 bg-[#011c3a]/95 text-white",
  light: "border border-neutral-200 bg-white/95 text-[#011c3a] shadow-[0_18px_50px_rgba(7,28,49,0.14)]",
  solid: "border border-transparent text-white",
};

/**
 * نمایشگر شمارنده جشنواره.
 * رنگ پسزمینه/تصویر پسزمینه/رنگ تأکید همه از پیکربندی استودیو میآید.
 */
export default function HeroCountdown({ config, size = "md" }: { config: HeroStudioConfig["countdown"]; size?: "sm" | "md" | "lg" }) {
  const state = useCountdown(config.target);
  if (!config.enabled) return null;

  const cells = state
    ? [
        { value: state.expired ? "۰۰" : PAD(state.days), label: "روز" },
        { value: state.expired ? "۰۰" : PAD(state.hours), label: "ساعت" },
        { value: state.expired ? "۰۰" : PAD(state.minutes), label: "دقیقه" },
        { value: state.expired ? "۰۰" : PAD(state.seconds), label: "ثانیه" },
      ]
    : null;

  const accent = config.accent || "#c9654d";
  const numeric = size === "sm" ? "text-[18px]" : size === "lg" ? "text-[30px] lg:text-[38px]" : "text-[22px] lg:text-[26px]";
  const pad = size === "sm" ? "px-3 py-2" : size === "lg" ? "px-5 py-4" : "px-4 py-3";

  return (
    <div dir="rtl" className="hero-countdown inline-flex flex-col items-center gap-2.5">
      {config.label ? (
        <p className="flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] opacity-90">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          {state?.expired ? `${config.label} (به پایان رسید)` : config.label}
        </p>
      ) : null}

      {state === null ? (
        <p className="text-[11.5px] opacity-75">زمان جشنواره تعیین نشده است.</p>
      ) : state.expired ? (
        <p className="text-[13px] font-medium">این جشنواره به پایان رسید؛ به زودی با رویداد بعدی کلبه برگردید.</p>
      ) : (
        <div
          className={"flex gap-2 " + (STYLE_CLASSES[config.style] ?? STYLE_CLASSES.glass)}
          style={{
            ...(config.bgColor ? { background: config.bgColor, borderColor: "transparent" } : {}),
            ...(config.bgImage
              ? { backgroundImage: `url(${config.bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }
              : {}),
            borderRadius: "0.75rem",
          }}
        >
          {(cells ?? []).map((cell, i) => (
            <div key={cell.label} className={"flex flex-col items-center " + pad + (i > 0 ? " border-r border-current/15" : "")}>
              <span className={"num-fa font-medium leading-none tabular-nums " + numeric} style={{ color: config.style === "light" ? accent : undefined }}>
                {cell.value}
              </span>
              <span className="mt-1.5 text-[9.5px] tracking-[0.18em] opacity-70">{cell.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
