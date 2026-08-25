import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

function readHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, search = ""] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(search) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readHash);

  useEffect(() => {
    const onChange = () => setState(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

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
