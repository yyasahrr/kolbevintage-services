import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MAKER_STATE, NORMAL_STATE } from "./e2e/helpers";

/**
 * لایهٔ مرورگریِ فاز ۶.۲ — سفرهای بحرانیِ پورتال تأمین‌کننده + رگرسیونِ بصری.
 *
 * این تست‌ها به یک نمونهٔ در حال اجرا از پلتفرم نیاز دارند:
 *   NEXT_PUBLIC_E2E_BASE_URL  (پیش‌فرض http://127.0.0.1:3000)
 *   KOLBE_E2E_SUPPLIER_EMAIL / KOLBE_E2E_SUPPLIER_PASSWORD
 *
 * اگر مرورگر یا اعتبارنامه موجود نباشد، تست‌ها **skip** می‌شوند (نه fail) تا CI
 * شکننده نشود؛ اما در محیطِ دارای مرورگر، همان سفرهای خواسته‌شده را اجرا می‌کنند.
 *
 * ── زمانِ اجرای مرورگر ───────────────────────────────────────────────────────
 * اولویت: مرورگرِ خودِ Playwright. اگر در کش نبود، از باینریِ آماده‌شده توسط
 * `scripts/setup-e2e-browser.mjs` (مسیر `.browsers/bin/chromium`) استفاده
 * می‌شود؛ این مسیر با `KOLBE_E2E_BROWSER_PATH` قابل جایگزینی است. هیچ آدرسی
 * hardcode نمی‌شود.
 */
const repoRoot = resolve(__dirname, "..");

/** باینریِ مرورگرِ محلی (خارج از git) یا مقدارِ صریحِ محیطی. */
function localBrowserExecutable(): string | undefined {
  const explicit = process.env.KOLBE_E2E_BROWSER_PATH?.trim();
  if (explicit) return explicit;
  const staged = resolve(repoRoot, ".browsers/bin/chromium");
  return existsSync(staged) ? staged : undefined;
}

const executablePath = localBrowserExecutable();

/** کتابخانه‌های هم‌نیازِ باینریِ آماده‌شده (NSS/NSPR + SwiftShader). */
function browserLaunchEnv(): Record<string, string> | undefined {
  if (!executablePath || executablePath.includes("ms-playwright")) return undefined;
  const libDir = resolve(repoRoot, ".browsers/lib");
  if (!existsSync(libDir)) return undefined;
  const existing = process.env.LD_LIBRARY_PATH ?? "";
  return { LD_LIBRARY_PATH: existing ? `${libDir}:${existing}` : libDir };
}

const launchOptions = {
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  env: { ...(process.env as Record<string, string>), ...(browserLaunchEnv() ?? {}) },
};

/**
 * ماتریسِ ۱۲ ویوپورتِ فاز ۶.۲.
 *
 * هر «کلاس» ویوپورت باید شواهدِ واقعی داشته باشد؛ اما قرار نیست هر سفرِ بحرانی
 * ۱۲ بار تکرار شود. تقسیمِ کار:
 *   • سفرهای بحرانی (journeys)  → دسکتاپ ۱۴۴۰ (روشن/تاریک) + موبایل ۳۶۰ (روشن/تاریک)
 *   • تعامل/کیبورد (interaction) → دسکتاپ ۱۴۴۰ (روشن/تاریک) + موبایل ۳۶۰
 *   • ویوپورت/سرریز/RTL (viewport) → همهٔ ۱۲ کلاس
 *   • رگرسیونِ بصری (visual)      → همهٔ ۱۲ کلاس، در دو تمِ نماینده
 */
const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 568, device: "mobile" },
  { name: "mobile-360", width: 360, height: 800, device: "mobile" },
  { name: "mobile-390", width: 390, height: 844, device: "mobile" },
  { name: "mobile-430", width: 430, height: 932, device: "mobile" },
  { name: "tablet-768", width: 768, height: 1024, device: "tablet" },
  { name: "tablet-820", width: 820, height: 1180, device: "tablet" },
  { name: "desktop-1024", width: 1024, height: 768, device: "desktop" },
  { name: "desktop-1280", width: 1280, height: 720, device: "desktop" },
  { name: "desktop-1366", width: 1366, height: 768, device: "desktop" },
  { name: "desktop-1440", width: 1440, height: 900, device: "desktop" },
  { name: "desktop-1920", width: 1920, height: 1080, device: "desktop" },
  { name: "desktop-2560", width: 2560, height: 1440, device: "desktop" },
] as const;

const JOURNEY_PROJECTS = new Set(["desktop-1440-light", "desktop-1440-dark", "mobile-360-light", "mobile-360-dark"]);
const INTERACTION_PROJECTS = new Set(["desktop-1440-light", "desktop-1440-dark", "mobile-360-light"]);

const SETUP_MATCH = "**/auth.setup.ts";

/**
 * پروژه‌های setup: یک ورودِ واقعی برای هر هویت، ذخیرهٔ `storageState`.
 * بدونِ این‌ها هر تست جداگانه login می‌کند و به محدودسازیِ نرخِ
 * `auth/login` (۵ در ۶۰ ثانیه بر IP) می‌خورد.
 */
const setupProjects = [
  { name: "setup-normal", testMatch: SETUP_MATCH, grep: /setup:normal-supplier/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
  { name: "setup-maker", testMatch: SETUP_MATCH, grep: /setup:maker-supplier/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
];

const projects = [...setupProjects];

for (const theme of ["light", "dark"] as const) {
  for (const vp of VIEWPORTS) {
    const name = `${vp.name}-${theme}`;
    // تمِ تاریک فقط برای ویوپورتهای نماینده (۱۴۴۰ و ۳۶۰) — بقیه پوششِ روشن دارند.
    if (theme === "dark" && name !== "desktop-1440-dark" && name !== "mobile-360-dark") continue;

    projects.push({
      name,
      dependencies: ["setup-normal"],
      testIgnore: [
        SETUP_MATCH,
        // سفرِ «تولید» فقط با هویتِ تولیدکننده معنا دارد.
        "**/supplier-production.spec.ts",
        ...(JOURNEY_PROJECTS.has(name) ? [] : ["**/supplier-journeys.spec.ts"]),
        ...(INTERACTION_PROJECTS.has(name) ? [] : ["**/supplier-interaction.spec.ts"]),
      ],
      use: {
        ...(vp.device === "mobile" ? devices["Galaxy S9+"] : devices["Desktop Chrome"]),
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.device === "mobile",
        hasTouch: vp.device === "mobile",
        colorScheme: theme,
        storageState: NORMAL_STATE,
        kolbeViewport: vp.name,
        kolbeTheme: theme,
        kolbeDeviceClass: vp.device,
      },
    });
  }
}

/**
 * پروژهٔ تأمین‌کنندهٔ تولیدکننده — اثباتِ اینکه دروازهٔ capability واقعاً
 * «باز» می‌شود (نه اینکه همیشه بسته باشد و تست بی‌معنا بگذرد).
 */
projects.push({
  name: "desktop-1440-light-maker",
  dependencies: ["setup-maker"],
  testMatch: "**/supplier-production.spec.ts",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    storageState: MAKER_STATE,
    kolbeViewport: "desktop-1440",
    kolbeTheme: "light",
    kolbeDeviceClass: "desktop",
  },
});

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.NEXT_PUBLIC_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    locale: "fa-IR",
    // پورتال فارسی و RTL است؛ جهتِ سند بخشی از قراردادِ بصری است.
    timezoneId: "Asia/Tehran",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions,
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  projects,
});
