import { lazy, Suspense } from "react";
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

export default function App() {
  const { location } = useHashRoute();
  const path = location.path;

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
