import { useEffect, useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "kolbe-storefront-theme-v2";
export const LEGACY_THEME_STORAGE_KEY = "kolbe-storefront-theme-v1";
export const THEME_ATTRIBUTE = "data-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export type ThemeEnvironment = {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  prefersDark: () => boolean;
  apply: (theme: ResolvedTheme) => void;
  subscribeSystem: (listener: () => void) => () => void;
};

const listeners = new Set<() => void>();
let preference: ThemePreference = "system";
let initialized = false;
let stopSystemSubscription: (() => void) | undefined;

function browserEnvironment(): ThemeEnvironment | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  return {
    read: (key) => window.localStorage.getItem(key),
    write: (key, value) => window.localStorage.setItem(key, value),
    prefersDark: () => media.matches,
    apply: (theme) => {
      document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
      document.documentElement.setAttribute("data-kolbe-mode", theme);
      document.documentElement.style.colorScheme = theme;
    },
    subscribeSystem: (listener) => {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
  };
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(value: ThemePreference, prefersDark = false): ResolvedTheme {
  return value === "system" ? (prefersDark ? "dark" : "light") : value;
}

export function readThemePreference(environment = browserEnvironment()): ThemePreference {
  if (!environment) return "system";
  try {
    const stored = environment.read(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
    const legacy = environment.read(LEGACY_THEME_STORAGE_KEY);
    if (legacy === "dark") return "dark";
    if (legacy === "liquid") return "light";
  } catch {
    // Storage may be unavailable. System preference remains a safe default.
  }
  return "system";
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyCurrent(environment = browserEnvironment()) {
  if (!environment) return;
  environment.apply(resolveTheme(preference, environment.prefersDark()));
}

export function initializeTheme(environment = browserEnvironment()) {
  if (!environment || initialized) return;
  initialized = true;
  preference = readThemePreference(environment);
  applyCurrent(environment);
  notify();
  stopSystemSubscription = environment.subscribeSystem(() => {
    if (preference !== "system") return;
    applyCurrent(environment);
    notify();
  });
}

export function setThemePreference(next: ThemePreference, environment = browserEnvironment()) {
  preference = next;
  if (environment) {
    try {
      environment.write(THEME_STORAGE_KEY, next);
    } catch {
      // The selected mode still applies for the current session.
    }
    applyCurrent(environment);
  }
  notify();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(environment = browserEnvironment()): ResolvedTheme {
  return resolveTheme(preference, environment?.prefersDark() ?? false);
}

export function useThemePreference() {
  useEffect(() => initializeTheme(), []);
  const selected = useSyncExternalStore(
    subscribe,
    getThemePreference,
    () => "system" as ThemePreference,
  );
  const resolved = useSyncExternalStore(subscribe, getResolvedTheme, () => "light" as ResolvedTheme);
  return {
    preference: selected,
    resolved,
    setPreference: setThemePreference,
  } as const;
}

/** Compatibility names used while portal code migrates to the three-state API. */
export type StorefrontTheme = ResolvedTheme;
export const readStorefrontTheme = (): StorefrontTheme => {
  const environment = browserEnvironment();
  return resolveTheme(readThemePreference(environment), environment?.prefersDark() ?? false);
};
export const applyStorefrontTheme = (theme: StorefrontTheme) => browserEnvironment()?.apply(theme);
export const saveStorefrontTheme = (theme: StorefrontTheme) => setThemePreference(theme);
export const useStorefrontTheme = (): StorefrontTheme => useThemePreference().resolved;

export function disposeThemeForTests() {
  stopSystemSubscription?.();
  stopSystemSubscription = undefined;
  initialized = false;
  preference = "system";
  listeners.clear();
}
