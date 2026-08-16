import { useState } from "react";
import { Link } from "../router";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import type { Product } from "../data/catalog";
import Icon from "./Icon";

export default function ProductCard({ product, compact = false }: { product: Product; compact?: boolean }) {
  const [idx, setIdx] = useState(0);
  const [colourIdx, setColourIdx] = useState(0);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const { addToCart, toggleWish, isWished, toggleCompare, compare } = useStore();

  const gallery = product.images;
  const shown = colourIdx > 0 ? product.colours[colourIdx].img : gallery[idx];
  const wished = isWished(product.id);
  const inCompare = compare.includes(product.id);
  const selectedColour = product.colours[colourIdx];

  const step = (dir: number) => {
    setColourIdx(0);
    setIdx((i) => (i + dir + gallery.length) % gallery.length);
  };

  const quickBuy = () => {
    if (!selectedSize) {
      setSizeOpen(true);
      return;
    }
    addToCart({
      id: product.id,
      name: product.name,
      colour: selectedColour.name,
      size: selectedSize,
      price: product.price,
      img: selectedColour.img,
    });
  };

  return (
    <div className="group relative">
      <Link to={`/product/${product.id}`} className="block">
        <div className="relative overflow-hidden bg-neutral-100">
          <img
            src={shown}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="aspect-[3/4] w-full object-cover transition-opacity duration-300"
          />

          {/* عکس دوم هنگام hover */}
          <img
            src={gallery[(idx + 1) % gallery.length]}
            alt=""
            loading="lazy"
            aria-hidden="true"
            className="absolute inset-0 aspect-[3/4] w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />

          {/* برچسب‌ها */}
          {product.badges.length > 0 && (
            <div className="absolute right-2 top-2 z-10 flex gap-1">
              {product.badges.slice(0, 2).map((b) => (
                <span
                  key={b}
                  className="rounded-[3px] bg-[#011c3a] px-2 py-[3px] text-[9px] font-medium text-white"
                >
                  {b}
                </span>
              ))}
            </div>
          )}

          {/* علاقه‌مندی */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleWish(product.id);
            }}
            aria-label="افزودن به علاقه‌مندی‌ها"
            className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur transition hover:bg-white"
          >
            <Icon
              name="heart"
              className="h-[15px] w-[15px]"
              fill={wished ? "#011c3a" : "none"}
            />
          </button>

          {/* فلش‌های پیمایش عکس */}
          {gallery.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="عکس بعدی"
                className="absolute right-1.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 opacity-0 transition group-hover:opacity-100 lg:flex"
              >
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="عکس قبلی"
                className="absolute left-1.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 opacity-0 transition group-hover:opacity-100 lg:flex"
              >
                <Icon name="chevronLeft" className="h-4 w-4" />
              </button>
            </>
          )}

          {/* نقطه‌های پیمایش */}
          {gallery.length > 1 && (
            <div className="absolute bottom-2 left-0 right-0 z-10 flex justify-center gap-1">
              {gallery.slice(0, 6).map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setColourIdx(0);
                    setIdx(i);
                  }}
                  aria-label={`عکس ${fa(i + 1)}`}
                  className={
                    "h-[3px] w-4 rounded-full transition " +
                    (i === idx && colourIdx === 0 ? "bg-[#011c3a]" : "bg-white/70")
                  }
                />
              ))}
            </div>
          )}
        </div>
      </Link>

      <div className="mt-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/product/${product.id}`} className="block truncate text-[12.5px] font-medium hover:underline">
              {product.name}
            </Link>
            <p className="truncate text-[11.5px] text-neutral-500">{product.subtitle}</p>
          </div>
          <span className="shrink-0 text-[12.5px] num-fa">{toman(product.price)}</span>
        </div>

        {/* سوآچ رنگ‌ها */}
        <div className="mt-2 flex items-center gap-1.5">
          {product.colours.slice(0, 6).map((c, i) => (
            <button
              key={c.name}
              onClick={() => {
                setColourIdx(i);
              }}
              title={c.name}
              aria-label={c.name}
              className={
                "h-[13px] w-[13px] rounded-full border transition " +
                (colourIdx === i ? "border-[#011c3a] ring-1 ring-[#011c3a]/30" : "border-neutral-300")
              }
              style={{ background: c.hex }}
            />
          ))}
          {product.colours.length > 6 && (
            <span className="text-[10.5px] text-neutral-400">+{fa(product.colours.length - 6)}</span>
          )}

          {!compact && (
            <button
              onClick={() => toggleCompare(product.id)}
              className={
                "mr-auto text-[10.5px] transition " +
                (inCompare ? "text-[#011c3a] underline" : "text-neutral-400 hover:text-[#011c3a]")
              }
            >
              {inCompare ? "در مقایسه" : "مقایسه"}
            </button>
          )}
        </div>

        {sizeOpen && (
          <div className="mt-3 grid grid-cols-4 gap-1 sm:grid-cols-7">
            {product.sizes.map((size) => (
              <button
                key={size.label}
                type="button"
                disabled={!size.inStock}
                onClick={() => setSelectedSize(size.label)}
                className={
                  "relative h-8 overflow-hidden border text-[10.5px] transition " +
                  (!size.inStock
                    ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-300 line-through"
                    : selectedSize === size.label
                      ? "border-[#011c3a] bg-[#011c3a] text-white"
                      : "border-neutral-300 hover:border-[#011c3a]")
                }
              >
                {size.label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={quickBuy}
          className={
            "mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[3px] text-[11.5px] font-medium transition active:scale-[0.99] " +
            (selectedSize
              ? "bg-[#011c3a] text-white hover:bg-[#0a2c55]"
              : "border border-[#011c3a] bg-white text-[#011c3a] hover:bg-[#f6f6f4]")
          }
        >
          {selectedSize && <Icon name="bag" className="h-3.5 w-3.5" />}
          {selectedSize ? `خرید سریع · سایز ${selectedSize}` : "انتخاب سایز"}
        </button>
      </div>
    </div>
  );
}
