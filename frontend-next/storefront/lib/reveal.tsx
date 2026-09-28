/**
 * آشکارسازی ملایم هنگام اسکرول — یک‌بار برای همیشه.
 *
 * قاعدهٔ قفل سبک (docs/design/style-lock.md):
 *  - هر بخش در هر نشست فقط **یک‌بار** انیمیشن ورودی می‌گیرد (پاسخ ۵۳).
 *  - فقط `opacity` و `transform` (بدون انیمیت پراپرتی‌های چیدمانی).
 *  - `prefers-reduced-motion` در CSS خنثی می‌شود؛ اینجا هم observer بسته می‌شود.
 */
import { useEffect, useRef, type ReactNode } from "react";

const seen = new Set<string>();

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
  id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion() || seen.has(id ?? node.dataset.kvRevealKey ?? "")) {
      node.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.classList.add("is-in");
          if (id) seen.add(id);
          observer.unobserve(target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [id]);

  return (
    <Tag
      ref={ref as never}
      id={id}
      className={`kv-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
