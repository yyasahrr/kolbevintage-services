import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { GlobalFilters } from "./components/GlobalFilters";
import { OrderDetailDrawer } from "./components/OrderDetailDrawer";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Topbar } from "./components/Topbar";
import { filtersFromParams, filtersToParams, type DashboardFilters } from "./domain/filters";
import { useHashRoute } from "./lib/useHashRoute";
import { useTheme, type ThemeMode } from "./lib/useTheme";
import { NAV_ITEMS } from "./nav";
import { DashboardPage } from "./pages/DashboardPage";
import { DashboardProvider, useDashboard } from "./state";

// Route-level code splitting: only the dashboard overview ships in the initial
// chunk; every other page (and the chart library it pulls in) loads on demand.
const OrdersPage = lazy(() => import("./pages/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const FulfillmentPage = lazy(() => import("./pages/FulfillmentPage").then((m) => ({ default: m.FulfillmentPage })));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage").then((m) => ({ default: m.SuppliersPage })));
const CustomersPage = lazy(() => import("./pages/CustomersPage").then((m) => ({ default: m.CustomersPage })));
const CataloguePage = lazy(() => import("./pages/CataloguePage").then((m) => ({ default: m.CataloguePage })));
const EscrowPage = lazy(() => import("./pages/EscrowPage").then((m) => ({ default: m.EscrowPage })));
const SettlementsPage = lazy(() => import("./pages/SettlementsPage").then((m) => ({ default: m.SettlementsPage })));
const DisputesPage = lazy(() => import("./pages/DisputesPage").then((m) => ({ default: m.DisputesPage })));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ProductsPage = lazy(() => import("./pages/ProductsPage").then((m) => ({ default: m.ProductsPage })));
const CataloguesPage = lazy(() => import("./pages/CataloguesPage").then((m) => ({ default: m.CataloguesPage })));
const ApplicationsPage = lazy(() =>
  import("./pages/ApplicationsPage").then((m) => ({ default: m.ApplicationsPage })),
);

function PageFallback() {
  return (
    <div className="flex flex-col gap-4" data-testid="page-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
    </div>
  );
}

function PageBody({
  path,
  openOrder,
  navigate,
  themeMode,
  setThemeMode,
}: {
  path: string;
  openOrder: (orderId: string) => void;
  navigate: (path: string, extra?: Record<string, string>) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  switch (path) {
    case "/admin/orders":
      return <OrdersPage onOpenOrder={openOrder} />;
    case "/admin/fulfillment":
      return <FulfillmentPage onOpenOrder={openOrder} />;
    case "/admin/suppliers":
      return <SuppliersPage onSelectSupplier={(id) => navigate("/admin/suppliers", { supplier: id, preset: "90d" })} />;
    case "/admin/applications":
      return <ApplicationsPage onOpenSuppliers={() => navigate("/admin/suppliers")} />;
    case "/admin/vip-customers":
      return <CustomersPage onSelectCustomer={(id) => navigate("/admin/vip-customers", { customer: id, preset: "90d" })} />;
    case "/admin/products":
      return <ProductsPage />;
    case "/admin/catalogues":
      return <CataloguesPage onOpenProducts={() => navigate("/admin/products")} />;
    case "/admin/catalogue-analytics":
      return <CataloguePage onSelectCatalogue={(id) => navigate("/admin/catalogue-analytics", { catalogue: id, preset: "90d" })} />;
    case "/admin/escrow":
      return <EscrowPage onOpenOrder={openOrder} />;
    case "/admin/settlements":
      return <SettlementsPage onOpenOrder={openOrder} />;
    case "/admin/disputes":
      return <DisputesPage onOpenOrder={openOrder} />;
    case "/admin/analytics":
      return <AnalyticsPage onNavigate={navigate} />;
    case "/admin/reports":
      return <ReportsPage />;
    case "/admin/settings":
      return <SettingsPage themeMode={themeMode} onThemeChange={setThemeMode} />;
    default:
      return <DashboardPage onOpenOrder={openOrder} onNavigate={navigate} />;
  }
}

function Shell({
  path,
  params,
  setParams,
  navigate,
  filters,
  setFilters,
}: {
  path: string;
  params: URLSearchParams;
  setParams: (params: Record<string, string>) => void;
  navigate: (path: string, params?: Record<string, string>) => void;
  filters: DashboardFilters;
  setFilters: (next: DashboardFilters) => void;
}) {
  const { data, index, now } = useDashboard();
  const { mode, setMode } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const orderId = params.get("order");
  const nav = NAV_ITEMS.find((n) => n.path === path) ?? NAV_ITEMS[0];
  // catalogue/product management pages are not driven by the date-range filters
  const hidesFilters =
    path === "/admin/products" || path === "/admin/catalogues" || path === "/admin/applications" || path === "/admin/settings";

  const openOrder = useCallback(
    (id: string) => {
      setParams({ ...filtersToParams(filters), order: id });
    },
    [filters, setParams],
  );

  const closeOrder = useCallback(() => {
    setParams(filtersToParams(filters));
  }, [filters, setParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  return (
    <div className="flex min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100" dir="rtl">
      <Sidebar
        currentPath={path}
        onNavigate={(p) => navigate(p, filtersToParams(filters))}
        onClose={() => setMenuOpen(false)}
        mobileOpen={menuOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={nav.label}
          subtitle={nav.description}
          themeMode={mode}
          onThemeChange={setMode}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          now={now}
        />
        {hidesFilters ? null : <GlobalFilters data={data} filters={filters} onChange={setFilters} />}
        <main className="flex-1 px-4 py-6 pb-[env(safe-area-inset-bottom)] sm:px-6" id="main">
          <Suspense fallback={<PageFallback />}>
            <PageBody
              path={path}
              openOrder={openOrder}
              navigate={(p, extra) => navigate(p, { ...filtersToParams(filters), ...extra })}
              themeMode={mode}
              setThemeMode={setMode}
            />
          </Suspense>
        </main>
      </div>

      <OrderDetailDrawer orderId={orderId} data={data} index={index} now={now} onClose={closeOrder} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} data={data} navigate={navigate} />
      <Toasts />
    </div>
  );
}

export function DashboardApp() {
  const { location, navigate, setParams } = useHashRoute();
  const filters = useMemo(() => filtersFromParams(location.params), [location.params]);

  const setFilters = useCallback(
    (next: DashboardFilters) => {
      const order = location.params.get("order");
      const params = filtersToParams(next);
      if (order) params.order = order;
      setParams(params);
    },
    [location.params, setParams],
  );

  return (
    <DashboardProvider filters={filters} setFilters={setFilters}>
      <Shell
        path={location.path}
        params={location.params}
        setParams={setParams}
        navigate={navigate}
        filters={filters}
        setFilters={setFilters}
      />
    </DashboardProvider>
  );
}
