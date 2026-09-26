import { beforeEach, describe, expect, it, vi } from "vitest";
import { disposeThemeForTests, initializeTheme, readThemePreference, resolveTheme, setThemePreference, THEME_STORAGE_KEY, type ResolvedTheme, type ThemeEnvironment } from "../storefront/theme";

function environment(initial: Record<string, string> = {}, dark = false) {
  const storage = new Map(Object.entries(initial));
  const applied: ResolvedTheme[] = [];
  let listener = () => {};
  let prefersDark = dark;
  const value: ThemeEnvironment = {
    read: (key) => storage.get(key) ?? null,
    write: (key, next) => { storage.set(key, next); },
    prefersDark: () => prefersDark,
    apply: (theme) => { applied.push(theme); },
    subscribeSystem: (next) => { listener = next; return vi.fn(); },
  };
  return { value, storage, applied, system(next: boolean) { prefersDark = next; listener(); } };
}

describe("Checkpoint 02 theme authority", () => {
  beforeEach(() => disposeThemeForTests());
  it("resolves light, dark and system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
  });
  it("persists one presentation preference", () => {
    const env = environment();
    setThemePreference("dark", env.value);
    expect(env.storage.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(env.applied).toEqual(["dark"]);
  });
  it("reacts to system changes only in system mode", () => {
    const env = environment({ [THEME_STORAGE_KEY]: "system" });
    initializeTheme(env.value);
    env.system(true);
    expect(env.applied).toEqual(["light", "dark"]);
    setThemePreference("light", env.value);
    env.system(false);
    expect(env.applied.at(-1)).toBe("light");
  });
  it("migrates legacy liquid without creating a second authority", () => {
    const env = environment({ "kolbe-storefront-theme-v1": "liquid" });
    expect(readThemePreference(env.value)).toBe("light");
  });
});
