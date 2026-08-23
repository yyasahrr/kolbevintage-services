import { useEffect } from "react";
import { Link } from "../router";
import { useStore, lineKey } from "../store";
import { toman, fa } from "../utils/format";
import Icon from "./Icon";

const FREE_SHIPPING = 3_000_000;

export default function CartDrawer() {
  const { cartOpen, setCartOpen, lines, cartTotal, removeLine, setLineQty } = useStore();

  useEffect(() => {
    document.body.style.overflow = cartOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [cartOpen]);

  if (!cartOpen) return null;

  const remaining = Math.max(0, FREE_SHIPPING - cartTotal);
  const progress = Math.min(100, (cartTotal / FREE_SHIPPING) * 100);

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
      <aside className="cart-drawer liquid-surface absolute inset-y-0 left-0 flex w-full max-w-[420px] flex-col bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 className="text-[15px] font-medium">
            سبد خرید {lines.length > 0 && <span className="text-neutral-400">({fa(lines.length)})</span>}
          </h2>
          <button onClick={() => setCartOpen(false)} aria-label="بستن" className="storefront-icon-action flex h-9 w-9 items-center justify-center rounded-full">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <Icon name="bag" className="h-10 w-10 text-neutral-300" />
            <p className="text-[13px] text-neutral-500">سبد خرید شما خالی است.</p>
            <Link
              to="/shop"
              onClick={() => setCartOpen(false)}
              className="storefront-primary-action rounded-full px-6 py-2.5 text-[12.5px]"
            >
              مشاهده محصولات
            </Link>
          </div>
        ) : (
          <>
            <div className="border-b border-neutral-100 px-5 py-3">
              <p className="text-[11.5px] text-neutral-600">
                {remaining > 0 ? (
                  <>
                    <span className="num-fa">{toman(remaining)}</span> تا ارسال رایگان
                  </>
                ) : (
                  "ارسال این سفارش رایگان است"
                )}
              </p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-200">
                <div className="cart-progress-fill h-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {lines.map((l) => {
                const k = lineKey(l);
                return (
                  <div key={k} className="flex gap-3 border-b border-neutral-100 py-4 first:pt-0">
                    <img src={l.img} alt={l.name} className="h-24 w-[70px] shrink-0 object-cover" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-medium">{l.name}</p>
                        <button onClick={() => removeLine(k)} aria-label="حذف" className="text-neutral-400 hover:text-[#011c3a]">
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        {l.colour} — سایز {l.size}
                      </p>
                      <div className="mt-2.5 flex items-center justify-between">
                        <div className="cart-quantity-control flex items-center rounded-full border border-neutral-300">
                          <button
                            onClick={() => setLineQty(k, l.qty - 1)}
                            className="flex h-8 w-8 items-center justify-center rounded-full"
                            aria-label="کاهش"
                          >
                            <Icon name="minus" className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-[12px] num-fa">{fa(l.qty)}</span>
                          <button
                            onClick={() => setLineQty(k, l.qty + 1)}
                            className="flex h-8 w-8 items-center justify-center rounded-full"
                            aria-label="افزایش"
                          >
                            <Icon name="plus" className="h-3 w-3" />
                          </button>
                        </div>
                        <span className="text-[12.5px] num-fa">{toman(l.price * l.qty)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cart-drawer-footer border-t border-neutral-200 px-5 py-4">
              <div className="flex items-center justify-between text-[13px]">
                <span>جمع کل</span>
                <span className="font-medium num-fa">{toman(cartTotal)}</span>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">هزینه ارسال در مرحله پرداخت محاسبه می‌شود.</p>
              <Link
                to="/checkout"
                onClick={() => setCartOpen(false)}
                className="storefront-primary-action mt-4 flex h-11 items-center justify-center rounded-full text-[13px] font-medium"
              >
                ادامه و پرداخت
              </Link>
              <Link
                to="/cart"
                onClick={() => setCartOpen(false)}
                className="storefront-secondary-action mt-2 flex h-10 items-center justify-center rounded-full text-[12.5px]"
              >
                مشاهده سبد خرید
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
