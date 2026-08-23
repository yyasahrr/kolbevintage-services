import { Link } from "../router";
import { useStore, lineKey } from "../store";
import { products } from "../data/catalog";
import { toman, fa } from "../utils/format";
import Icon from "../components/Icon";
import ProductCard from "../components/ProductCard";

const FREE = 3_000_000;

export default function Cart() {
  const { lines, cartTotal, removeLine, setLineQty } = useStore();
  const shipping = cartTotal >= FREE || cartTotal === 0 ? 0 : 89_000;

  if (lines.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 px-4 py-24 text-center">
        <Icon name="bag" className="h-12 w-12 text-neutral-300" />
        <h1 className="text-[20px] font-medium">سبد خرید شما خالی است</h1>
        <p className="text-[12.5px] text-neutral-500">هنوز محصولی به سبد اضافه نکرده‌اید.</p>
        <Link to="/shop" className="rounded-[3px] bg-[#011c3a] px-8 py-3 text-[13px] font-medium text-white">
          شروع خرید
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full px-4 py-10 lg:px-8 lg:py-14">
      <h1 className="mb-8 text-[24px] font-medium">سبد خرید</h1>

      <div className="grid gap-10 lg:grid-cols-[1fr_360px] lg:gap-14">
        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          {lines.map((l) => {
            const k = lineKey(l);
            return (
              <div key={k} className="flex gap-4 py-5">
                <Link to={`/product/${l.id}`} className="shrink-0">
                  <img src={l.img} alt={l.name} className="h-32 w-24 object-cover" loading="lazy" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link to={`/product/${l.id}`} className="text-[13.5px] font-medium hover:underline">
                        {l.name}
                      </Link>
                      <p className="mt-1 text-[11.5px] text-neutral-500">
                        {l.colour} — سایز {l.size}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] num-fa">{toman(l.price)}</span>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-4">
                    <div className="flex items-center border border-neutral-300">
                      <button onClick={() => setLineQty(k, l.qty - 1)} className="flex h-8 w-8 items-center justify-center hover:bg-neutral-50" aria-label="کاهش">
                        <Icon name="minus" className="h-3 w-3" />
                      </button>
                      <span className="w-10 text-center text-[12.5px] num-fa">{fa(l.qty)}</span>
                      <button onClick={() => setLineQty(k, l.qty + 1)} className="flex h-8 w-8 items-center justify-center hover:bg-neutral-50" aria-label="افزایش">
                        <Icon name="plus" className="h-3 w-3" />
                      </button>
                    </div>
                    <button onClick={() => removeLine(k)} className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 hover:text-[#011c3a]">
                      <Icon name="trash" className="h-3.5 w-3.5" />
                      حذف
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="self-start lg:sticky lg:top-[124px]">
          <div className="liquid-panel rounded-[3px] border border-neutral-200 p-5">
            <h2 className="text-[15px] font-medium">خلاصه سفارش</h2>
            <div className="mt-4 space-y-2.5 border-b border-neutral-200 pb-4 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-neutral-600">جمع کالاها</span>
                <span className="num-fa">{toman(cartTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">هزینه ارسال</span>
                <span className="num-fa">{shipping === 0 ? "رایگان" : toman(shipping)}</span>
              </div>
            </div>
            <div className="flex justify-between pt-4 text-[14px] font-medium">
              <span>مبلغ قابل پرداخت</span>
              <span className="num-fa">{toman(cartTotal + shipping)}</span>
            </div>

            <Link
              to="/checkout"
              className="mt-5 flex h-11 items-center justify-center rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55]"
            >
              ادامه و پرداخت
            </Link>
            <Link to="/shop" className="mt-2 block text-center text-[12px] text-neutral-500 hover:underline">
              ادامه خرید
            </Link>

            <ul className="mt-5 space-y-2 border-t border-neutral-200 pt-4 text-[11.5px] text-neutral-600">
              {["پرداخت امن از طریق درگاه بانکی", "۳۰ روز مهلت مرجوعی", "ارسال به سراسر ایران"].map((t) => (
                <li key={t} className="flex gap-2">
                  <Icon name="check" className="mt-[3px] h-3 w-3 shrink-0" strokeWidth={2.6} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <section className="mt-16">
        <h2 className="mb-5 text-[17px] font-medium">شاید این‌ها را هم بخواهید</h2>
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4">
          {products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </main>
  );
}
