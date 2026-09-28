/**
 * جدول‌های پنل روی موبایل → کارت (پاسخ ۴۷ کاربر: «کارت در موبایل، جدول در دسکتاپ»).
 *
 * چرا این‌گونه؟ جدول‌های پنل زیاد و متنوع‌اند؛ بازنویسی دستی همه‌شان پرریسک است.
 * این محافظ یک لایهٔ عمومی است: سرِ ستون‌ها را می‌خواند و همان عنوان را به‌عنوان
 * `data-label` روی هر سلول می‌گذارد. CSS (`app/globals.css` → بخش پنل) در عرض‌های
 * کوچک هر سطر را به یک کارت با جفت «برچسب/مقدار» تبدیل می‌کند و در دسکتاپ هیچ
 * تغییری در ظاهر جدول نمی‌دهد. بدون هیچ تغییری در منطق داده یا ستون‌ها.
 */
import { useEffect, useRef, type ReactNode } from "react";

export default function ResponsiveTable({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const annotate = () => {
      for (const table of Array.from(host.querySelectorAll("table"))) {
        const headers = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
        if (headers.length === 0) continue;
        for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
          const cells = Array.from(row.querySelectorAll(":scope > td"));
          cells.forEach((cell, index) => {
            const header = headers[index] ?? "";
            if (header && !cell.hasAttribute("data-label")) cell.setAttribute("data-label", header);
          });
        }
      }
    };

    annotate();
    // ردیف‌های تازه‌ای که با فیلتر/جست‌وجو اضافه می‌شوند هم برچسب می‌گیرند.
    const observer = new MutationObserver(annotate);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [children]);

  return (
    <div ref={ref} className={`kv-table-wrap ${className}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/**
 * همان منطق، اما برای کل یک پنل: یک بار روی ریشهٔ پنل اعمال می‌شود و هر جدولی
 * که بعداً (با lazy/Suspense یا تغییر تب) ساخته شود هم خودکار برچسب می‌گیرد.
 * این‌گونه لازم نیست ده‌ها جدول را دستی بازنویسی کنیم.
 */
export function useResponsiveTables(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    if (!host) return;

    const annotate = () => {
      for (const table of Array.from(host.querySelectorAll("table"))) {
        if (table.dataset.kvLabelled === "1") continue;
        const headers = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
        if (headers.length === 0) continue;
        for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
          Array.from(row.querySelectorAll(":scope > td")).forEach((cell, index) => {
            const header = headers[index] ?? "";
            if (header && !cell.hasAttribute("data-label")) cell.setAttribute("data-label", header);
          });
        }
        table.dataset.kvLabelled = "1";
        table.setAttribute("data-kv-responsive", "true");
      }
    };

    annotate();
    const observer = new MutationObserver(annotate);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
}
