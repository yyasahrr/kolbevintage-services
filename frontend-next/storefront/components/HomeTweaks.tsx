/**
 * پنل شناور «تنظیم زنده» — برای انتخاب سریع واریانت صفحهٔ اصلی با چشم.
 *
 * رفتار: به‌صورت پیش‌فرض بسته است و با یک دکمهٔ کوچک در گوشهٔ پایین باز می‌شود؛
 * انتخاب‌ها در localStorage می‌مانند. در محیط توسعه همیشه دیده می‌شود و در
 * نسخهٔ نهایی فقط با پارامتر `?tweaks=1` (یا دکمهٔ کوچک) قابل بازکردن است تا
 * ظاهر نهایی برای مشتری دست‌نخورده بماند.
 */
import { useEffect, useState } from "react";
import { homeVariants, setHomeVariant, useHomeVariant, type HomeVariant } from "../homeVariant";

const SPRING = "cubic-bezier(0.22, 0.61, 0.36, 1)";

export default function HomeTweaks() {
  const active = useHomeVariant();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tweaks") === "1";
    setAvailable(requested || process.env.NODE_ENV !== "production");
  }, []);

  if (!available) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 print:hidden" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded-full border border-[var(--kv-border)] bg-[var(--kv-surface)] px-4 py-2 text-[11px] shadow-[var(--kv-shadow-card)]"
        style={{ transition: `transform 160ms ${SPRING}, background-color 160ms ease` }}
      >
        {open ? "بستن تنظیم زنده" : "تنظیم زندهٔ ظاهر"}
      </button>

      {open ? (
        <div
          className="mt-3 w-[286px] rounded-[var(--kv-radius-surface)] border border-[var(--kv-border)] bg-[var(--kv-surface)] p-4 shadow-[var(--kv-shadow-overlay)]"
          style={{ animation: `kv-tweaks-in 220ms ${SPRING}` }}
        >
          <p className="kv-label text-[var(--kv-text-muted)]">واریانت صفحهٔ اصلی</p>
          <div className="mt-3 grid gap-2">
            {(Object.keys(homeVariants) as HomeVariant[]).map((id) => {
              const spec = homeVariants[id];
              const selected = active.id === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setHomeVariant(id)}
                  className="rounded-[var(--kv-radius-control)] border p-3 text-right"
                  style={{
                    borderColor: selected ? "var(--kv-accent)" : "var(--kv-border)",
                    background: selected ? "color-mix(in srgb, var(--kv-accent) 12%, transparent)" : "transparent",
                    transition: `background-color 160ms ease, border-color 160ms ease`,
                  }}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-[12.5px] font-medium">{spec.name}</span>
                    {selected ? <span className="text-[10px] text-[var(--kv-accent)]">فعال</span> : null}
                  </span>
                  <span className="mt-1 block text-[10.5px] leading-5 text-[var(--kv-text-muted)]">{spec.summary}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] leading-5 text-[var(--kv-text-muted)]">
            انتخاب شما ذخیره می‌شود و در همهٔ بازدیدهای بعدی همین واریانت نمایش داده می‌شود.
          </p>
        </div>
      ) : null}
    </div>
  );
}
