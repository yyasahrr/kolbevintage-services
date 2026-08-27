import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "../router";
import { products } from "../data/catalog";
import { fa, toman } from "../utils/format";
import Icon from "../components/Icon";
import { loadWholesaleMembership } from "../wholesaleMembership";
import { restoreWholesaleVip, signInWholesaleVip } from "../lib/wholesaleVipApi";
import { loadWholesaleVipProducts } from "../lib/wholesaleVipApi";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import CartDrawer from "../components/CartDrawer";
import CompareBar from "../components/CompareBar";
import Toasts from "../components/Toasts";

/* ================================================================
   صفحه خرید عمده — مثل فروشگاه‌های بزرگ:
   محصولات برای عموم قابل مشاهده، قیمت فقط برای اعضای VIP فعال
   ================================================================ */

type WholesaleProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  wholesalePrice: number;
  imageUrl: string | null;
  variants: Array<{ id: string; color: string; size: string; available: number }>;
};

export default function Wholesale() {
  const { query } = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("همه");
  const [sortBy, setSortBy] = useState("newest");
  const [catalog, setCatalog] = useState<WholesaleProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [vipAccount, setVipAccount] = useState<{ storeName: string; planName: string } | null>(null);

  /* بازیابی نشست VIP */
  useEffect(() => {
    restoreWholesaleVip().then(account => {
      if (account) setVipAccount({ storeName: account.storeName, planName: account.planName });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  /* بارگذاری کاتالوگ عمده — حتی بدون ورود قابل مشاهده است */
  useEffect(() => {
    loadWholesaleVipProducts()
      .then(products => setCatalog(products))
      .catch(() => {
        /* fallback به کاتالوگ محلی */
        setCatalog(products.map(p => ({
          id: p.id, name: p.name, sku: p.specs?.code ?? "", category: p.categoryLabel ?? "",
          description: p.subtitle ?? "", wholesalePrice: Math.round(p.price * 0.65),
          imageUrl: p.images?.[0] ?? null,
          variants: p.colours?.map(c => ({ id: `${p.id}-${c.name}`, color: c.name, size: "—", available: 10 })) ?? [],
        })));
        setLoading(false);
      });
  }, []);

  /* فیلترها */
  const categories = useMemo(() => ["همه", ...new Set(catalog.map(p => p.category).filter(Boolean))], [catalog]);
  const filtered = useMemo(() => {
    let list = catalog;
    if (category !== "همه") list = list.filter(p => p.category === category);
    if (search.trim()) list = list.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()));
    if (sortBy === "cheap") list = [...list].sort((a, b) => a.wholesalePrice - b.wholesalePrice);
    if (sortBy === "expensive") list = [...list].sort((a, b) => b.wholesalePrice - a.wholesalePrice);
    return list;
  }, [catalog, category, search, sortBy]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const account = await signInWholesaleVip(loginEmail, loginPassword);
      setVipAccount({ storeName: account.storeName, planName: account.planName });
      setShowLogin(false);
      /* بارگذاری مجدد کاتالوگ با قیمتها */
      const prods = await loadWholesaleVipProducts();
      setCatalog(prods);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "ورود انجام نشد.");
    }
  };

  return (
    <div className="storefront-shell flex min-h-screen flex-col bg-[#f7f5f0]">
      <SiteHeader />
      <div className="flex-1">

        {/* بنر بالای صفحه */}
        <section className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-5 lg:px-8">
            <div>
              <p className="text-[10px] tracking-[0.3em] text-neutral-400">WHOLESALE MARKET</p>
              <h1 className="mt-2 text-[24px] font-medium text-[#011c3a]">بازار عمده کلبه</h1>
              <p className="mt-1 text-[12px] text-neutral-500">
                {catalog.length > 0 ? `${fa(catalog.length)} محصول عمده` : "کاتالوگ عمده"} از تأمین‌کنندگان منتخب
              </p>
            </div>
            {vipAccount ? (
              <div className="flex items-center gap-3 rounded-full border border-[#b9cfbc] bg-[#edf3ee] px-5 py-2.5">
                <Icon name="shield" className="h-4 w-4 text-[#3d5c3a]" />
                <div>
                  <p className="text-[12px] font-medium text-[#36563a]">{vipAccount.storeName}</p>
                  <p className="text-[9.5px] text-[#3d5c3a]">عضویت {vipAccount.planName} فعال — قیمت‌ها نمایش داده می‌شود</p>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="flex items-center gap-2 rounded-full bg-[#011c3a] px-6 py-3 text-[12px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px"
              >
                <Icon name="user" className="h-4 w-4" />
                ورود / عضویت VIP برای مشاهده قیمت
              </button>
            )}
          </div>
        </section>

        {/* نوار فیلتر */}
        <section className="sticky top-[73px] z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
            <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-neutral-300 bg-white px-4 md:max-w-md">
              <Icon name="search" className="h-4 w-4 text-neutral-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="جستجو در محصولات عمده…"
                className="h-full flex-1 bg-transparent text-[12px] outline-none placeholder:text-neutral-400"
              />
            </div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[11px] transition ${
                    category === cat
                      ? "border-[#011c3a] bg-[#011c3a] text-white"
                      : "border-neutral-300 bg-white text-neutral-600 hover:border-[#011c3a]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="h-10 rounded-full border border-neutral-300 bg-white px-4 text-[11px] outline-none"
              aria-label="مرتب‌سازی"
            >
              <option value="newest">جدیدترین</option>
              <option value="cheap">ارزان‌ترین</option>
              <option value="expensive">گران‌ترین</option>
            </select>
          </div>
        </section>

        {/* گرید محصولات */}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg bg-white p-3">
                  <div className="aspect-[4/5] rounded bg-neutral-200" />
                  <div className="mt-3 h-3 w-3/4 rounded bg-neutral-200" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-neutral-200" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[11.5px] text-neutral-500">{fa(filtered.length)} محصول</p>
                {!vipAccount && (
                  <p className="flex items-center gap-1.5 text-[10.5px] text-neutral-400">
                    <Icon name="shield" className="h-3.5 w-3.5" />
                    قیمت‌ها فقط برای اعضای VIP
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filtered.map(product => (
                  <WholesaleCard key={product.id} product={product} hasVip={Boolean(vipAccount)} onLogin={() => setShowLogin(true)} />
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="py-20 text-center">
                  <p className="text-[14px] font-medium text-neutral-500">محصولی یافت نشد</p>
                  <p className="mt-2 text-[12px] text-neutral-400">عبارت دیگری جستجو کنید یا فیلتر را تغییر دهید.</p>
                </div>
              )}
            </>
          )}
        </main>

        {/* بخش پایین: مزایا + CTA برای غیرعضوها */}
        {!vipAccount && !loading && catalog.length > 0 && (
          <section className="border-t border-neutral-200 bg-[#011c3a] py-14 text-white">
            <div className="mx-auto max-w-[1200px] px-4 text-center lg:px-8">
              <p className="text-[10px] tracking-[0.35em] text-white/50">WHOLESALE MEMBERSHIP</p>
              <h2 className="mt-4 text-[26px] font-medium">مشاهده قیمت و خرید عمده</h2>
              <p className="mx-auto mt-3 max-w-lg text-[13px] leading-[2] text-white/70">
                محصولات عمده برای همه قابل مشاهده است، اما برای دیدن قیمت‌ها و ثبت سفارش
                باید عضو VIP کلبه باشید.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {[
                  { icon: "shield", title: "تخفیف عمده تا ۳۵٪", text: "قیمت‌های ویژه اعضا روی کل کاتالوگ" },
                  { icon: "truck", title: "ارسال رایگان", text: "برای سفارش‌های بالای ۳ میلیون تومان" },
                  { icon: "needle", title: "برند اختصاصی", text: "سفارش با لیبل و بسته‌بندی برند خودتان" },
                ].map(b => (
                  <div key={b.title} className="border border-white/15 p-5 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/25">
                      <Icon name={b.icon} className="h-5 w-5 text-white/80" strokeWidth={1.4} />
                    </div>
                    <p className="mt-3 text-[13px] font-medium">{b.title}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">{b.text}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-8 rounded-full bg-white px-8 py-3.5 text-[13px] font-medium text-[#011c3a] transition hover:bg-neutral-100 active:translate-y-px"
              >
                ورود / ثبت‌نام عضویت VIP
              </button>
            </div>
          </section>
        )}
      </div>

      {/* دیالوگ ورود */}
      {showLogin && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-4" onClick={() => setShowLogin(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-5 text-center">
              <p className="text-[10px] tracking-[0.3em] text-neutral-400">VIP ACCESS</p>
              <h3 className="mt-2 text-[18px] font-medium text-[#011c3a]">ورود به حساب VIP</h3>
              <p className="mt-1 text-[11px] text-neutral-500">برای مشاهده قیمت‌های عمده وارد شوید</p>
            </div>
            {loginError && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{loginError}</p>}
            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="email"
                required
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="ایمیل"
                autoComplete="email"
                className="h-11 w-full rounded border border-neutral-300 px-3 text-[12px] outline-none focus:border-[#011c3a]"
              />
              <input
                type="password"
                required
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="رمز عبور"
                autoComplete="current-password"
                className="h-11 w-full rounded border border-neutral-300 px-3 text-[12px] outline-none focus:border-[#011c3a]"
              />
              <button type="submit" className="h-11 w-full rounded bg-[#011c3a] text-[12.5px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px">
                ورود و نمایش قیمت‌ها
              </button>
            </form>
            <p className="mt-4 text-center text-[10.5px] text-neutral-400">
              عضو نیستید؟{" "}
              <Link to="/wholesale" className="text-[#011c3a] underline" onClick={() => setShowLogin(false)}>
                درخواست عضویت VIP
              </Link>
            </p>
          </div>
        </div>
      )}

      <SiteFooter />
      <CartDrawer />
      <Toasts />
    </div>
  );
}

/* ================================================================
   کارت محصول عمده — قیمت فقط برای VIP
   ================================================================ */

function WholesaleCard({ product, hasVip, onLogin }: { product: WholesaleProduct; hasVip: boolean; onLogin: () => void }) {
  const [hovered, setHovered] = useState(false);
  const totalStock = product.variants?.reduce((s, v) => s + (v.available ?? 0), 0) ?? 0;

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-lg bg-white transition-shadow hover:shadow-lg"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* تصویر */}
      <div className="relative overflow-hidden bg-neutral-100">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center bg-neutral-100">
            <Icon name="bag" className="h-8 w-8 text-neutral-300" />
          </div>
        )}
        {totalStock > 0 && (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-medium text-[#011c3a] backdrop-blur">
            {fa(totalStock)} تکه
          </span>
        )}
      </div>

      {/* اطلاعات */}
      <div className="flex flex-1 flex-col p-3">
        <p className="text-[9.5px] text-neutral-400">{product.category}</p>
        <h3 className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-[#011c3a]">{product.name}</h3>

        {/* رنگها */}
        {product.variants && product.variants.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {[...new Set(product.variants.map(v => v.color))].slice(0, 5).map(color => (
              <span key={color} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[8.5px] text-neutral-500">{color}</span>
            ))}
          </div>
        )}

        {/* قیمت */}
        <div className="mt-auto pt-3">
          {hasVip ? (
            <div>
              <p className="text-[14px] font-medium text-[#011c3a] num-fa">{toman(product.wholesalePrice)}</p>
              <p className="mt-0.5 text-[9px] text-neutral-400">قیمت عمده هر تیکه</p>
              <button className="mt-2 h-9 w-full rounded-full bg-[#011c3a] text-[11px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px">
                افزودن به سفارش
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[#011c3a]/20 bg-[#f7f5f0] text-[11px] text-[#011c3a] transition hover:border-[#011c3a] hover:bg-white"
            >
              <Icon name="shield" className="h-3.5 w-3.5" />
              ورود برای مشاهده قیمت
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
