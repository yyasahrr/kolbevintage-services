import { useEffect, useState } from "react";
import { Link, useRouter } from "../router";
import { mainNav, styles } from "../siteData";
import { useStore } from "../store";
import { products } from "../data/catalog";
import { fa } from "../utils/format";
import Icon from "./Icon";
import { readStorefrontTheme, saveStorefrontTheme, type StorefrontTheme } from "../theme";
import { useSiteSettings } from "../siteSettings";

const categoryNavLabels = new Set(["کت و بلیزر", "پیراهن", "بافت و پلیور", "شلوار", "اکسسوری"]);
const categoryNav = mainNav.filter((item) => categoryNavLabels.has(item.label));

export default function SiteHeader() {
  const settings = useSiteSettings();
  const desktopNav = settings.header.nav;
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [theme, setTheme] = useState<StorefrontTheme>(readStorefrontTheme);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const { path } = useRouter();
  const { cartCount, setCartOpen, wishlist } = useStore();

  useEffect(() => {
    setOpen(false);
    setSearchOpen(false);
    setCatalogOpen(false);
  }, [path]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const toggleTheme = () => {
    const nextTheme: StorefrontTheme = theme === "dark" ? "liquid" : "dark";
    setTheme(nextTheme);
    saveStorefrontTheme(nextTheme);
  };

  const results = q.trim()
    ? products.filter((p) => (p.name + p.subtitle + p.latin).includes(q.trim())).slice(0, 5)
    : [];

  return (
    <header className="site-header sticky top-0 z-50 bg-white">
      {/* هدر فشرده تک‌ردیفه */}
      <div className="site-primary border-b border-neutral-200">
        <div className="relative mx-auto flex min-h-[66px] max-w-[1600px] items-center gap-4 px-4 lg:gap-6 lg:px-6">
          <button className="shrink-0 lg:hidden" onClick={() => setOpen(true)} aria-label="منو">
            <Icon name="menu" className="h-6 w-6" />
          </button>

          <Link to="/" className="absolute right-1/2 flex translate-x-1/2 flex-col items-center leading-none">
            <span className="whitespace-nowrap text-[18px] font-semibold tracking-[0.14em] lg:text-[19px]">
              {settings.header.brand}
            </span>
            <span className="mt-[3px] text-[8px] tracking-[0.38em] text-neutral-400">
              {settings.header.latinBrand}
            </span>
          </Link>

          <div className="mr-auto flex shrink-0 items-center gap-4 lg:gap-4">
            <Link to="/wholesale" className="hidden h-9 items-center rounded-full border border-neutral-300 px-4 text-[11px] font-medium transition hover:border-current lg:flex">خرید عمده</Link>
            <button type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تاریک"} title={theme === "dark" ? "تم روشن" : "تم تاریک"} className="theme-toggle flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 transition hover:rotate-6 active:scale-95">
              <Icon name={theme === "dark" ? "sun" : "moon"} className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
            <button aria-label="جستجو" className="hover:opacity-60" onClick={() => setSearchOpen(!searchOpen)}>
              <Icon name="search" />
            </button>
            <Link to="/account" aria-label="حساب کاربری" className="hidden hover:opacity-60 sm:block">
              <Icon name="user" />
            </Link>
            <Link to="/wishlist" aria-label="علاقه‌مندی‌ها" className="relative hidden hover:opacity-60 sm:block">
              <Icon name="heart" />
              {wishlist.length > 0 && (
                <span className="absolute -left-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#011c3a] px-1 text-[9px] text-white">
                  {fa(wishlist.length)}
                </span>
              )}
            </Link>
            <button aria-label="سبد خرید" className="relative hover:opacity-60" onClick={() => setCartOpen(true)}>
              <Icon name="bag" />
              {cartCount > 0 && (
                <span className="absolute -left-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#011c3a] px-1 text-[9px] text-white">
                  {fa(cartCount)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ردیف دوم: منوی دسکتاپ — وسطچین با هاور زیرخطی یکسان */}
        <nav
          className="site-navigation hidden border-t border-neutral-200/70 lg:block"
          onKeyDown={(event) => event.key === "Escape" && setCatalogOpen(false)}
        >
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-8 gap-y-1 px-4 py-1.5 text-[12px] lg:px-6">
            {desktopNav.map((item) => {
              const isActive = path === item.to.split("?")[0];
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  aria-current={isActive ? "page" : undefined}
                  className={`site-nav-underline whitespace-nowrap border-b py-2 transition ${
                    isActive ? "border-current font-medium" : "border-transparent hover:border-current"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="catalog-picker relative">
              <button
                type="button"
                onClick={() => setCatalogOpen((isOpen) => !isOpen)}
                aria-haspopup="menu"
                aria-expanded={catalogOpen}
                className="site-nav-underline flex items-center gap-1.5 whitespace-nowrap border-b border-transparent py-2 transition hover:border-current"
              >
                دسته‌بندی‌ها
                <Icon name="chevronDown" className={`h-3 w-3 transition-transform ${catalogOpen ? "rotate-180" : ""}`} />
              </button>

              {catalogOpen && (
                <div
                  role="menu"
                  aria-label="دسته‌بندی محصولات"
                  className="catalog-menu liquid-surface absolute right-0 top-11 z-[90] w-[340px] rounded-[1.35rem] border border-neutral-200 p-3"
                >
                  <div className="grid grid-cols-2 gap-1">
                    {categoryNav.map((item) => (
                      <Link key={item.label} to={item.to} role="menuitem" className="catalog-menu-item rounded-lg px-3 py-2.5">
                        {item.label}
                      </Link>
                    ))}
                  </div>
                  <Link to="/try-on" role="menuitem" className="tryon-menu-link mt-2 flex items-center gap-2 rounded-xl px-3 py-3">
                    <Icon name="star" className="h-4 w-4" />
                    <span>
                      <span className="block text-[11.5px] font-medium">Try On Me</span>
                      <span className="mt-0.5 block text-[9.5px] opacity-70">امتحان محصول روی تصویر خودت</span>
                    </span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </nav>
      </div>

      {/* جستجو */}
      {searchOpen && (
        <div className="site-search liquid-surface">
          <div className="mx-auto max-w-[900px] px-4 py-4 sm:px-6">
            <div className="search-input-shell flex items-center gap-3 rounded-full border border-neutral-200 px-4 py-3">
              <Icon name="search" className="h-4 w-4 shrink-0 text-neutral-400" />
              <input
                autoFocus
                aria-label="جستجوی محصولات"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="دنبال چه چیزی می‌گردید؟ مثلاً بلیزر پشمی"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
              />
              <button className="search-close flex h-8 w-8 shrink-0 items-center justify-center rounded-full" onClick={() => setSearchOpen(false)} aria-label="بستن جستجو">
                <Icon name="close" className="h-4 w-4 text-neutral-400" />
              </button>
            </div>

            {results.length > 0 && (
              <div className="search-results mt-3 grid gap-1.5 border-t border-neutral-100 pt-3 sm:grid-cols-2">
                {results.map((p) => (
                  <Link key={p.id} to={`/product/${p.id}`} className="search-result-item flex items-center gap-3 rounded-xl p-2">
                    <img src={p.images[0]} alt="" className="h-12 w-10 rounded-lg object-cover" loading="lazy" />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px]">{p.name}</p>
                      <p className="truncate text-[11px] text-neutral-500">{p.subtitle}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {q.trim() && results.length === 0 && (
              <p className="mt-3 rounded-xl border border-neutral-200 px-4 py-3 text-[11.5px] text-neutral-500">
                محصولی با این عبارت پیدا نشد؛ نام دسته یا جنس محصول را امتحان کنید.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
              <span className="ml-1 text-neutral-500">جستجوهای پرتکرار:</span>
              {styles.map((s) => (
                <Link
                  key={s.slug}
                  to={`/styles?s=${s.slug}`}
                  className="search-chip rounded-full border border-neutral-300 px-3 py-1.5 hover:border-[#011c3a]"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* کشوی منوی موبایل */}
      {open && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="mobile-navigation liquid-surface absolute inset-y-0 right-0 flex w-[86%] max-w-[340px] flex-col bg-white">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <span>
                <span className="block text-[15px] font-semibold tracking-[0.14em]">کلبه وینتیج</span>
                <span className="mt-1 block text-[9px] text-neutral-500">مسیر سریع خرید</span>
              </span>
              <button className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200" onClick={() => setOpen(false)} aria-label="بستن منو">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <Link to="/try-on" className="tryon-menu-link flex items-center justify-between rounded-2xl px-4 py-3.5">
                <span>
                  <span className="block text-[13px] font-medium">Try On Me</span>
                  <span className="mt-1 block text-[10px] opacity-70">لباس را روی تصویر خودت امتحان کن</span>
                </span>
                <Icon name="star" className="h-5 w-5" />
              </Link>

              <nav className="mobile-menu-links mt-4 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 px-4">
                {[
                  { label: "جدیدترین محصولات", to: "/shop?sort=new" },
                  { label: "کالکشن پاییز", to: "/collection" },
                  { label: "همه محصولات", to: "/shop" },
                  { label: "استایل‌ها", to: "/styles" },
                  { label: "مجله کلبه", to: "/blog" },
                ].map((item) => (
                  <Link key={item.label} to={item.to} className="flex items-center justify-between py-3.5 text-[12.5px]">
                    {item.label}
                    <Icon name="arrowLeft" className="h-3.5 w-3.5 opacity-35" />
                  </Link>
                ))}
              </nav>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link to="/account" className="mobile-menu-item flex items-center justify-center gap-2 rounded-xl border border-neutral-200 py-3 text-[11.5px]">
                  <Icon name="user" className="h-4 w-4" /> حساب من
                </Link>
                <Link to="/wishlist" className="mobile-menu-item flex items-center justify-center gap-2 rounded-xl border border-neutral-200 py-3 text-[11.5px]">
                  <Icon name="heart" className="h-4 w-4" /> علاقه‌مندی {wishlist.length > 0 && `(${fa(wishlist.length)})`}
                </Link>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3 text-[10.5px] text-neutral-500">
              <Link to="/contact">راهنمای خرید و پیگیری</Link>
              <Link to="/wholesale">فروش عمده</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
