export type StorefrontTheme = "liquid" | "dark";

export const STOREFRONT_THEME_KEY = "kolbe-storefront-theme-v1";

export function readStorefrontTheme(): StorefrontTheme {
  try {
    const storedTheme = window.localStorage.getItem(STOREFRONT_THEME_KEY);
    return storedTheme === "dark" ? "dark" : "liquid";
  } catch {
    return "liquid";
  }
}

export function applyStorefrontTheme(theme: StorefrontTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
}

export function saveStorefrontTheme(theme: StorefrontTheme) {
  applyStorefrontTheme(theme);
  try {
    window.localStorage.setItem(STOREFRONT_THEME_KEY, theme);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}
