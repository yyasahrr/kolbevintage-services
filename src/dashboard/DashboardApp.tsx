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
const SupplierPortalPage = lazy(() =>
  import("./pages/SupplierPortalPage").then((m) => ({ default: m.SupplierPortalPage })),
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
  params,
  openOrder,
  navigate,
  themeMode,
  setThemeMode,
}: {
  path: string;
  params: URLSearchParams;
  openOrder: (orderId: string) => void;
  navigate: (path: string, extra?: Record<string, string>) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  switch (path) {
    case "/orders":
      return <OrdersPage onOpenOrder={openOrder} />;
    case "/fulfillment":
      return <FulfillmentPage onOpenOrder={openOrder} />;
    case "/suppliers":
      return <SuppliersPage onSelectSupplier={(id) => navigate("/suppliers", { supplier: id, preset: "90d" })} />;
    case "/vip-customers":
      return <CustomersPage onSelectCustomer={(id) => navigate("/vip-customers", { customer: id, preset: "90d" })} />;
    case "/catalogue":
      return <CataloguePage onSelectCatalogue={(id) => navigate("/catalogue", { catalogue: id, preset: "90d" })} />;
    case "/escrow":
      return <EscrowPage onOpenOrder={openOrder} />;
    case "/settlements":
      return <SettlementsPage onOpenOrder={openOrder} />;
    case "/disputes":
      return <DisputesPage onOpenOrder={openOrder} />;
    case "/analytics":
      return <AnalyticsPage onNavigate={navigate} />;
    case "/reports":
      return <ReportsPage />;
    case "/settings":
      return <SettingsPage themeMode={themeMode} onThemeChange={setThemeMode} />;
    case "/supplier-portal":
      return (
        <SupplierPortalPage
          supplierId={params.get("supplier") ?? "sup-1"}
          onSelectSupplier={(id) => navigate("/supplier-portal", { supplier: id })}
        />
      );
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
  const isPortal = path === "/supplier-portal";

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
        {/* the supplier portal is deliberately excluded from Kolbe-side global filters */}
        {isPortal ? null : <GlobalFilters data={data} filters={filters} onChange={setFilters} />}
        <main className="flex-1 px-4 py-6 pb-[env(safe-area-inset-bottom)] sm:px-6" id="main">
          <Suspense fallback={<PageFallback />}>
            <PageBody
              path={path}
              params={params}
              openOrder={openOrder}
              navigate={(p, extra) => navigate(p, { ...filtersToParams(filters), ...extra })}
              themeMode={mode}
              setThemeMode={setMode}
            />
          </Suspense>
        </main>
      </div>

      {isPortal ? null : (
        <OrderDetailDrawer orderId={orderId} data={data} index={index} now={now} onClose={closeOrder} />
      )}
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
