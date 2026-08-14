import { useEffect } from "react";
import { RouterProvider, useRouter } from "./router";
import { StoreProvider } from "./store";
import { applySeo } from "./seo";

import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import CartDrawer from "./components/CartDrawer";
import CompareBar from "./components/CompareBar";
import Toasts from "./components/Toasts";
import PromoPopup from "./components/PromoPopup";

import Home from "./pages/Home";
import Shop from "./pages/Shop";
import ProductPage from "./pages/ProductPage";
import Styles from "./pages/Styles";
import Collection from "./pages/Collection";
import { BlogList, BlogPost } from "./pages/Blog";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Wholesale from "./pages/Wholesale";
import Admin from "./pages/Admin";
import { About, Contact, Wishlist, Compare, Account, NotFound } from "./pages/Static";

function Routes() {
  const { path } = useRouter();

  useEffect(() => {
    applySeo(path);
  }, [path]);

  /* صفحات با چیدمان مستقل (هدر/فوتر اختصاصی) */
  if (path === "/wholesale") return <Wholesale />;
  if (path === "/admin") return <Admin />;

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
  else page = <NotFound />;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <div className="flex-1">{page}</div>
      <SiteFooter />
      <CartDrawer />
      <CompareBar />
      <Toasts />
      <PromoPopup />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <RouterProvider>
        <Routes />
      </RouterProvider>
    </StoreProvider>
  );
}
