import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { productIdFromPath, trackCommerceEvent } from "./lib/analytics";

type RouterValue = {
  path: string;
  query: URLSearchParams;
  navigate: (to: string) => void;
};

const RouterContext = createContext<RouterValue>({
  path: "/",
  query: new URLSearchParams(),
  navigate: () => {},
});

function readLocation() {
  const hashRoute = window.location.hash.replace(/^#/, "");
  const raw = hashRoute || `${window.location.pathname}${window.location.search}` || "/";
  const [path, search = ""] = raw.split("?");
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return { path: normalizedPath || "/", query: new URLSearchParams(search) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readLocation);

  useEffect(() => {
    const onChange = () => setState(readLocation());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  useEffect(() => {
    const productId = productIdFromPath(state.path);
    trackCommerceEvent({ name: productId ? "product_view" : "page_view", path: state.path, productId, source: document.referrer || "direct" });
  }, [state.path]);

  const navigate = (to: string) => {
    const target = to.startsWith("#") ? to.slice(1) : to;
    if (target === state.path + (state.query.toString() ? "?" + state.query.toString() : "")) return;
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  return (
    <RouterContext.Provider value={{ ...state, navigate }}>{children}</RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}

export function Link({
  to,
  className = "",
  children,
  ...rest
}: {
  to: string;
  className?: string;
  children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { navigate } = useRouter();
  return (
    <a
      href={"#" + to}
      className={className}
      onClick={(e) => {
        // Interactive controls inside a linked card can cancel navigation.
        if (e.defaultPrevented) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
