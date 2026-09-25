import { useEffect, useLayoutEffect } from "react";
import { RouterProvider, useRouter } from "./router";
import { StoreProvider } from "./store";
import { SessionProvider } from "./session/SessionProvider";
import { applySeo } from "./seo";
import { initializeClientLogging } from "./lib/clientLogger";
import { syncSiteSettingsFromServer, useSiteSettings } from "./siteSettings";
import { useStorefrontTheme } from "./theme";
import { applyDesignSystem } from "./designSystem";

import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import CartDrawer from "./components/CartDrawer";
import CompareBar from "./components/CompareBar";
import Toasts from "./components/Toasts";
import PromoPopup from "./components/PromoPopup";
import MobileTryOnButton from "./components/MobileTryOnButton";
import SeasonalAtmosphere from "./components/SeasonalAtmosphere";

import Home from "./pages/Home";
import Shop from "./pages/Shop";
import ProductPage from "./pages/ProductPage";
import Styles from "./pages/Styles";
import Collection from "./pages/Collection";
import { BlogList, BlogPost } from "./pages/Blog";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Wholesale from "./pages/Wholesale";
import VIPPortal from "./pages/VIPPortal";
import AdminPortal from "./pages/AdminPortal";
import { About, Contact, Wishlist, Compare, Account, NotFound } from "./pages/Static";
import TryOn from "./pages/TryOn";
import LegalPage from "./pages/Legal";

function Routes() {
  const { path, query } = useRouter();
  const { designSystem, builder } = useSiteSettings();
  const storefrontTheme = useStorefrontTheme();

  useLayoutEffect(() => {
    applyDesignSystem(designSystem, storefrontTheme === "dark" ? "dark" : "light");
  }, [designSystem, storefrontTheme]);

  useLayoutEffect(() => {
    const id = "kolbe-custom-fonts";
    let element = document.getElementById(id) as HTMLStyleElement | null;
    if (!element) { element = document.createElement("style"); element.id = id; document.head.appendChild(element); }
    const safe = (value:string) => value.replace(/[{};'"\\]/g, "");
    const faces = builder.typography.customFonts.map((font) => `@font-face{font-family:'${safe(font.name)}';src:url('${font.url}') format('${font.format}');font-display:swap;}`).join("\n");
    const siteFont = builder.typography.siteFont === "inherit" ? "inherit" : `'${safe(builder.typography.siteFont)}'`;
    const headingFont = builder.typography.headingFont === "inherit" ? siteFont : `'${safe(builder.typography.headingFont)}'`;
    const promoFont = builder.typography.promotionalFont === "inherit" ? headingFont : `'${safe(builder.typography.promotionalFont)}'`;
    element.textContent = `${faces}\n:root{--site-font:${siteFont};--site-heading-font:${headingFont};--site-promotional-font:${promoFont}}body{font-family:var(--site-font)}h1,h2,h3{font-family:var(--site-heading-font)}`;
    return () => { element?.remove(); };
  }, [builder.typography]);

  useEffect(() => {
    applySeo(path);
  }, [path]);

  /* صفحات با چیدمان مستقل (هدر/فوتر اختصاصی) */
  if (path === "/wholesale" || path === "/wholesale/join") return <Wholesale />;
  if (path === "/wholesale-dashboard") return <VIPPortal />;
  if (path === "/vip" || path.startsWith("/vip/")) return <VIPPortal />;
  if (path.startsWith("/product/") && query.get("wholesale") === "1") return <VIPPortal />;
  if (path === "/admin") return <AdminPortal />;

  let page: React.ReactNode;

  if (path === "/") page = <Home />;
  else if (path === "/shop") page = <Shop />;
  else if (path.startsWith("/product/")) page = <ProductPage id={path.split("/")[2]} />;
  else if (path === "/styles") page = <Styles />;
  else if (path === "/collection") page = <Collection />;
  else if (path === "/blog") page = <BlogList />;
  else if (path.startsWith("/blog/")) page = <BlogPost slug={path.split("/")[2]} />;
  else if (path === "/cart") page = <Cart />;
  else if (path === "/checkout") page = <Checkout />;
  else if (path === "/about") page = <About />;
  else if (path === "/contact") page = <Contact />;
  else if (path === "/wishlist") page = <Wishlist />;
  else if (path === "/compare") page = <Compare />;
  else if (path === "/account") page = <Account />;
  else if (path === "/try-on") page = <TryOn />;
  else if (path === "/terms") page = <LegalPage page="terms" />;
  else if (path === "/privacy") page = <LegalPage page="privacy" />;
  else if (path === "/returns") page = <LegalPage page="returns" />;
  else if (path === "/shipping") page = <LegalPage page="shipping" />;
  else if (path === "/wholesale-terms") page = <LegalPage page="wholesale-terms" />;
  else page = <NotFound />;

  return (
    <div className="storefront-shell flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <SeasonalAtmosphere />
      <main className="site-main flex-1">{page}</main>
      <SiteFooter />
      <MobileTryOnButton />
      <CartDrawer />
      <CompareBar />
      <Toasts />
      <PromoPopup />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    initializeClientLogging();
    void syncSiteSettingsFromServer();
  }, []);

  return (
    <StoreProvider>
      <SessionProvider>
        <RouterProvider>
          <Routes />
        </RouterProvider>
      </SessionProvider>
    </StoreProvider>
  );
}
