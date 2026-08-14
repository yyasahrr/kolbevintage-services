import { DashboardApp } from "./dashboard/DashboardApp";
import StorefrontApp from "./StorefrontApp";
import { useHashRoute } from "./dashboard/lib/useHashRoute";

/**
 * Hash router root.
 *   #/store        → preserved MR MARVIS storefront demo (LTR, English)
 *   everything else → Kolbe Vintage wholesale operations dashboard (RTL, Persian)
 */
export default function App() {
  const { location } = useHashRoute();

  if (location.path === "/store") {
    return (
      <div dir="ltr" className="bg-white text-[#011c3a]">
        <a
          href="#/dashboard"
          className="fixed bottom-4 right-4 z-50 rounded-full bg-[#011c3a] px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          ← Back to wholesale dashboard
        </a>
        <StorefrontApp />
      </div>
    );
  }

  return <DashboardApp />;
}
