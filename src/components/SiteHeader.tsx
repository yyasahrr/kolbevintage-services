import { useEffect, useState } from "react";
import { Link, useRouter } from "../router";
import { mainNav, utilityNav, styles } from "../siteData";
import { useStore } from "../store";
import { products } from "../data/catalog";
import { fa } from "../utils/format";
import Icon from "./Icon";

const messages = [
  "ارسال رایگان برای سفارش‌های بالای ۳ میلیون تومان",
  "۳۰ روز مهلت مرجوعی — بدون پرسش",
  "دوخت دست در کارگاه اختصاصی کلبه",
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(0);
  const { path } = useRouter();
  const { cartCount, setCartOpen, wishlist } = useStore();

  useEffect(() => {
    setOpen(false);
    setSearchOpen(false);
  }, [path]);

  useEffect(() => {
    const t = setInterval(() => setMsg((m) => (m + 1) % messages.length), 4500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const results = q.trim()
    ? products.filter((p) => (p.name + p.subtitle + p.latin).includes(q.trim())).slice(0, 5)
    : [];

  return (
    <header className="sticky top-0 z-50 bg-white">
      {/* نوار اعلان چرخشی */}
      <div className="bg-[#011c3a] text-white">
        <div className="relative mx-auto flex h-[30px] max-w-[1600px] items-center justify-center overflow-hidden px-4 text-[11px] tracking-wide">
          <span key={msg} className="fade-up">
            {messages[msg]}
          </span>
        </div>
      </div>

      {/* نوار کمکی دسکتاپ */}
      <div className="hidden border-b border-neutral-200 lg:block">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-1.5 text-[11px] text-[#011c3a]">
          {utilityNav.map((u) => (
            <Link key={u.label} to={u.to} className="hover:underline">
              {u.label}
            </Link>
          ))}
          <Link to="/wholesale" className="font-medium hover:underline">
            فروش عمده
          </Link>
          <span className="mr-auto flex items-center gap-1.5 text-neutral-500">
            <span className="inline-block h-3 w-4 overflow-hidden rounded-[1px]">
              <svg viewBox="0 0 6 3" className="h-full w-full">
                <rect width="6" height="1" y="0" fill="#239f40" />
                <rect width="6" height="1" y="1" fill="#fff" />
                <rect width="6" height="1" y="2" fill="#da0000" />
              </svg>
            </span>
            فارسی — تومان
          </span>
        </div>
      </div>

      {/* نوار اصلی */}
      <div className="border-b border-neutral-200">
        <div className="relative mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 lg:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="منو">
            <Icon name="menu" className="h-6 w-6" />
          </button>

          <Link to="/" className="mx-auto flex flex-col items-center leading-none lg:mx-0 lg:absolute lg:right-1/2 lg:translate-x-1/2">
            <span className="whitespace-nowrap text-[19px] font-semibold tracking-[0.16em] lg:text-[21px]">
              کلبه وینتیج
            </span>
            <span className="mt-[3px] text-[8.5px] tracking-[0.42em] text-neutral-400">
              KOLBE VINTAGE
            </span>
          </Link>

          <div className="flex items-center gap-4 lg:gap-5">
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

        <nav className="hidden justify-center gap-7 pb-2 text-[13px] lg:flex">
          {mainNav.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              className="border-b border-transparent pb-1 transition hover:border-[#011c3a]"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* جستجو */}
      {searchOpen && (
        <div className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-[900px] px-6 py-4">
            <div className="flex items-center gap-3">
              <Icon name="search" className="h-4 w-4 text-neutral-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="دنبال چه چیزی می‌گردید؟ مثلاً بلیزر پشمی"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
              />
              <button onClick={() => setSearchOpen(false)} aria-label="بستن">
                <Icon name="close" className="h-4 w-4 text-neutral-400" />
              </button>
            </div>

            {results.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
                {results.map((p) => (
                  <Link key={p.id} to={`/product/${p.id}`} className="flex items-center gap-3 hover:bg-neutral-50">
                    <img src={p.images[0]} alt="" className="h-12 w-10 object-cover" loading="lazy" />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px]">{p.name}</p>
                      <p className="truncate text-[11px] text-neutral-500">{p.subtitle}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-[11.5px]">
              <span className="text-neutral-500">جستجوهای پرتکرار:</span>
              {styles.map((s) => (
                <Link
                  key={s.slug}
                  to={`/styles?s=${s.slug}`}
                  className="rounded-[3px] border border-neutral-300 px-2.5 py-1 hover:border-[#011c3a]"
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
          <div className="absolute inset-y-0 right-0 flex w-[86%] max-w-[340px] flex-col bg-white">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <span className="text-[15px] font-semibold tracking-[0.14em]">کلبه وینتیج</span>
              <button onClick={() => setOpen(false)} aria-label="بستن">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              {mainNav.map((n) => (
                <Link key={n.label} to={n.to} className="block border-b border-neutral-100 py-3 text-[14.5px]">
                  {n.label}
                </Link>
              ))}
              <Link to="/wholesale" className="block border-b border-neutral-100 py-3 text-[14.5px] font-medium">
                فروش عمده
              </Link>
              {utilityNav.map((n) => (
                <Link key={n.label} to={n.to} className="block border-b border-neutral-100 py-3 text-[13px] text-neutral-600">
                  {n.label}
                </Link>
              ))}
              <Link to="/wishlist" className="block py-3 text-[13px] text-neutral-600">
                علاقه‌مندی‌های من {wishlist.length > 0 && `(${fa(wishlist.length)})`}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
