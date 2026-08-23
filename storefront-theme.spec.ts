import { expect, test } from "@playwright/test";

test("storefront keeps only Liquid and Dark Liquid and persists the selection", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 820 });
  await page.goto("http://127.0.0.1:4173/#/", { waitUntil: "domcontentloaded" });

  const themePicker = page.getByRole("button", { name: /انتخاب تم ظاهر/ });
  await expect(themePicker).toBeVisible();
  await expect(page.locator(".site-announcement")).toHaveCount(0);
  await expect(page.locator(".site-utility")).toHaveCount(0);
  await expect(page.locator(".site-primary .site-navigation")).toBeVisible();
  await expect.poll(() => page.locator(".site-primary").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(80);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "liquid");

  await themePicker.click();
  await expect(page.getByRole("menuitemradio", { name: "انتخاب تم کلاسیک" })).toHaveCount(0);
  await page.getByRole("menuitemradio", { name: "انتخاب تم لیکویید روشن" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "liquid");
  await expect(page.locator(".site-header")).toHaveCSS("position", "sticky");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("kolbe-storefront-theme-v1"))).toBe("liquid");

  await themePicker.click();
  await page.getByRole("menuitemradio", { name: "انتخاب تم دارک لیکویید" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("kolbe-storefront-theme-v1"))).toBe("dark");
  await expect(page.locator(".storefront-shell")).toHaveCSS("color", "rgb(245, 241, 233)");

  const productAction = page.getByRole("button", { name: "انتخاب سایز" }).first();
  await expect.poll(() => productAction.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(20);

  await page.getByRole("button", { name: "سبد خرید" }).click();
  await expect(page.locator(".cart-drawer")).toBeVisible();
  await expect(page.locator(".cart-drawer")).toHaveCSS("border-radius", "27.2px");

  await page.locator(".cart-drawer").getByRole("button", { name: "بستن" }).click();
  await themePicker.click();
  await page.getByRole("menuitemradio", { name: "انتخاب تم لیکویید روشن" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "liquid");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("kolbe-storefront-theme-v1"))).toBe("liquid");

  await page.getByRole("button", { name: "جستجو" }).click();
  const searchPanel = page.locator(".site-search");
  await expect(searchPanel).toBeVisible();
  await expect.poll(() => searchPanel.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(20);
  await expect(page.getByRole("textbox", { name: "جستجوی محصولات" })).toBeFocused();

  await page.getByRole("button", { name: "بستن جستجو" }).click();
  await page.getByRole("button", { name: "دسته‌بندی‌ها" }).click();
  await expect(page.getByRole("menu", { name: "دسته‌بندی محصولات" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Try On Me/ })).toBeVisible();

  await expect(page.getByRole("link", { name: /شروع تجربه Try On Me/ })).toBeVisible();
  await expect(page.locator(".shop-look-section")).toBeVisible();
});

test("mobile navigation uses the Dark Liquid glass surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/#/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /انتخاب تم ظاهر/ }).click();
  await page.getByRole("menuitemradio", { name: "انتخاب تم دارک لیکویید" }).click();
  await expect(page.getByRole("link", { name: /شروع تجربه Try On Me/ })).toBeVisible();

  await page.getByRole("button", { name: "جستجو" }).click();
  const mobileSearchBox = await page.locator(".site-search").boundingBox();
  expect(mobileSearchBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((mobileSearchBox?.x ?? 0) + (mobileSearchBox?.width ?? 999)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "بستن جستجو" }).click();

  await page.getByRole("button", { name: "منو" }).click();

  const mobileNavigation = page.locator(".mobile-navigation");
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation).toHaveCSS("border-radius", "27.2px");
  await expect(mobileNavigation).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
});
