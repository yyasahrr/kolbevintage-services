import { useCallback, useEffect, useState } from "react";

export interface HashLocation {
  path: string;
  params: URLSearchParams;
}

function parseHash(): HashLocation {
  const raw = window.location.hash.replace(/^#/, "") || "/dashboard";
  const [path, query = ""] = raw.split("?");
  return { path: path || "/dashboard", params: new URLSearchParams(query) };
}

export function useHashRoute(): {
  location: HashLocation;
  navigate: (path: string, params?: Record<string, string>) => void;
  setParams: (params: Record<string, string>) => void;
} {
  const [location, setLocation] = useState<HashLocation>(() =>
    typeof window === "undefined" ? { path: "/dashboard", params: new URLSearchParams() } : parseHash(),
  );

  useEffect(() => {
    const onChange = () => setLocation(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((path: string, params?: Record<string, string>) => {
    const search = params ? new URLSearchParams(params).toString() : "";
    window.location.hash = search ? `${path}?${search}` : path;
  }, []);

  const setParams = useCallback((params: Record<string, string>) => {
    const current = parseHash();
    const search = new URLSearchParams(params).toString();
    window.location.hash = search ? `${current.path}?${search}` : current.path;
  }, []);

  return { location, navigate, setParams };
}
