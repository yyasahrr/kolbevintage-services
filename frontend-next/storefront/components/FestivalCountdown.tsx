import HeroCountdown from "./HeroCountdown";
import type { CountdownComponent } from "../siteSettings";

/*
 * کامپوننت شمارنده جشنواره — قابل نصب روی هر نقطه از سایت:
 * روی هیرو، بنر بزرگ (بنرساز)، بنر وسط و بنرهای پایین صفحه.
 * از تب «کامپوننت‌ها» در سایت‌ساز مدیریت میشود.
 */

const POSITION_CLASS: Record<CountdownComponent["position"], string> = {
  top: "top-[12%] items-start",
  center: "top-1/2 -translate-y-1/2 items-center",
  bottom: "bottom-[10%] items-end",
};

const ALIGN_CLASS: Record<CountdownComponent["align"], string> = {
  right: "right-4 lg:right-12",
  center: "inset-x-0 justify-center",
  left: "left-4 lg:left-12",
};

/**
 * لایهٔ شمارنده که روی هر بنر/هیرو قرار میگیرد.
 * والد باید `relative` باشد؛ خود لایه absolute است و کلیک را فقط روی شمارنده قبول میکند.
 */
export default function FestivalCountdownOverlay({
  config,
  where,
}: {
  config: CountdownComponent;
  where: keyof CountdownComponent["placement"];
}) {
  if (!config.enabled || !config.placement[where]) return null;

  return (
    <div
      className={`pointer-events-none absolute z-20 flex px-4 py-3 ${POSITION_CLASS[config.position]} ${ALIGN_CLASS[config.align]}`}
    >
      <div className="pointer-events-auto drop-shadow-[0_16px_40px_rgba(7,20,34,0.35)]">
        <HeroCountdown config={config} size={config.size} />
      </div>
    </div>
  );
}
