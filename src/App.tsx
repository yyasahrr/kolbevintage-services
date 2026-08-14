import { lazy, Suspense, useEffect } from "react";
import StorefrontApp from "./StorefrontApp";
import { useHashRoute } from "./dashboard/lib/useHashRoute";

const DashboardApp = lazy(() =>
  import("./dashboard/DashboardApp").then((m) => ({ default: m.DashboardApp })),
);
const SupplierApplyPage = lazy(() =>
  import("./supplier/SupplierApplyPage").then((m) => ({ default: m.SupplierApplyPage })),
);
const SupplierPortalApp = lazy(() =>
  import("./supplier/SupplierPortalApp").then((m) => ({ default: m.SupplierPortalApp })),
);

/**
 * Top-level areas, kept deliberately separate:
 *
 *   /                 storefront — the public shop (default landing page)
 *   /admin/*          Kolbe Vintage operations dashboard (internal, staff only)
 *   /supplier-apply   public partnership application form
 *   /partner/*        supplier portal — a supplier's own workspace
 *
 * The storefront and the supplier area never share a shell with the admin
 * dashboard, so a customer surface can never leak internal supplier data.
 */
function AreaFallback() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-slate-300 border-t-navy dark:border-slate-700 dark:border-t-sky-400" />
        <p className="text-xs text-slate-500 dark:text-slate-400">در حال بارگذاری…</p>
      </div>
    </div>
  );
}

/**
 * The document is LTR/English by default (the storefront). Persian areas flip
 * `dir` and `lang` on <html> while they are mounted, then restore it on exit,
 * so RTL styling never leaks into the shop.
 */
function useDocumentDirection(rtl: boolean) {
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("dir", rtl ? "rtl" : "ltr");
    el.setAttribute("lang", rtl ? "fa" : "en");
    return () => {
      el.setAttribute("dir", "ltr");
      el.setAttribute("lang", "en");
    };
  }, [rtl]);
}

export default function App() {
  const { location } = useHashRoute();
  const path = location.path;
  const isPersianArea =
    path.startsWith("/admin") || path.startsWith("/partner") || path === "/supplier-apply";

  useDocumentDirection(isPersianArea);

  if (path.startsWith("/admin")) {
    return (
      <Suspense fallback={<AreaFallback />}>
        <DashboardApp />
      </Suspense>
    );
  }

  if (path === "/supplier-apply") {
    return (
      <Suspense fallback={<AreaFallback />}>
        <SupplierApplyPage />
      </Suspense>
    );
  }

  if (path.startsWith("/partner")) {
    return (
      <Suspense fallback={<AreaFallback />}>
        <SupplierPortalApp />
      </Suspense>
    );
  }

  return <StorefrontApp />;
}
