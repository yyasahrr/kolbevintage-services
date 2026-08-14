import { useCallback, useEffect, useMemo, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { GlobalFilters } from "./components/GlobalFilters";
import { OrderDetailDrawer } from "./components/OrderDetailDrawer";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { filtersFromParams, filtersToParams, type DashboardFilters } from "./domain/filters";
import { useHashRoute } from "./lib/useHashRoute";
import { useTheme } from "./lib/useTheme";
import { NAV_ITEMS } from "./nav";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CataloguePage } from "./pages/CataloguePage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DisputesPage } from "./pages/DisputesPage";
import { EscrowPage } from "./pages/EscrowPage";
import { FulfillmentPage } from "./pages/FulfillmentPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SettlementsPage } from "./pages/SettlementsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { DashboardProvider, useDashboard } from "./state";

function PageBody({
  path,
  openOrder,
  navigate,
  themeMode,
  setThemeMode,
}: {
  path: string;
  openOrder: (orderId: string) => void;
  navigate: (path: string, params?: Record<string, string>) => void;
  themeMode: ReturnType<typeof useTheme>["mode"];
  setThemeMode: ReturnType<typeof useTheme>["setMode"];
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

  const openOrder = useCallback(
    (id: string) => {
      const next = { ...filtersToParams(filters), order: id };
      setParams(next);
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
        <GlobalFilters data={data} filters={filters} onChange={setFilters} />
        <main className="flex-1 px-4 py-6 pb-[env(safe-area-inset-bottom)] sm:px-6" id="main">
          <PageBody
            path={path}
            openOrder={openOrder}
            navigate={(p, extra) => navigate(p, { ...filtersToParams(filters), ...extra })}
            themeMode={mode}
            setThemeMode={setMode}
          />
        </main>
      </div>

      <OrderDetailDrawer orderId={orderId} data={data} index={index} now={now} onClose={closeOrder} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} data={data} navigate={navigate} />
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
