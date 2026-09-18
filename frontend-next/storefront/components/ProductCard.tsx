import { useState } from "react";
import { Link } from "../router";
import { useStore } from "../store";
import { toman, fa } from "../utils/format";
import type { Product } from "../data/catalog";
import { isInstallmentAvailable, type PurchaseChannel } from "../lib/purchaseChannel";
import Icon from "./Icon";
import { useSiteSettings } from "../siteSettings";

/**
 * کارت محصول — **فقط کانال خرده‌فروشی**.
 *
 * ⚠️ `channel` (اصلاح D22): کارت امروز فقط در صفحات خرده‌فروشی
 * (خانه/فروشگاه/کالکشن/…‌) استفاده می‌شود، اما پیش از این هیچ قید کانالی نداشت و
 * بخش «اقساطی» را بی‌قید رندر می‌کرد؛ اگر روزی در پورتال عمده هم سوار شود،
 * قاعدهٔ «BNPL فقط خرده‌فروشی» به‌طور خاموش نقض می‌شد. اکنون پیش‌فرض خرده‌فروشی
 * است و مصرف‌کنندهٔ عمده باید صریحاً `channel="wholesale"` بدهد.
 */
export default function ProductCard({
  product,
  compact = false,
  channel = "retail",
}: {
  product: Product;
  compact?: boolean;
  channel?: PurchaseChannel;
}) {
  const [idx, setIdx] = useState(0);
  const [colourIdx, setColourIdx] = useState(0);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const { addToCart, toggleWish, isWished, toggleCompare, compare } = useStore();
  const { builder } = useSiteSettings();
  const cardSettings = builder.productCard;
  const installment = builder.components.installment;
  const mediaRatio = cardSettings.imageRatio === "square" ? "aspect-square" : cardSettings.imageRatio === "landscape" ? "aspect-[4/3]" : "aspect-[4/5]";
  const mediaRadius = cardSettings.radius === "round" ? "rounded-[18px]" : cardSettings.radius === "soft" ? "rounded-[6px]" : "rounded-none";
  const campaign = builder.campaign;
  const productCollections = (product as Product & { admin?: { collections?: string[] } }).admin?.collections ?? [];
  const now = Date.now();
  const campaignInTime = campaign.enabled && (!campaign.startsAt || new Date(campaign.startsAt).getTime() <= now) && (!campaign.endsAt || new Date(campaign.endsAt).getTime() >= now);
  const campaignMatches = campaign.targetType === "all" || (campaign.targetType === "category" && campaign.targetValue === product.category) || (campaign.targetType === "collection" && productCollections.includes(campaign.targetValue)) || (campaign.targetType === "product" && campaign.targetValue === product.id);
  const salePrice = campaignInTime && campaignMatches ? Math.round(product.price * (1 - campaign.discountPercent / 100)) : product.price;
  const installmentPrice = Math.round(salePrice * (1 + installment.markupPercent / 100));

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
      price: salePrice,
      img: selectedColour.img,
    });
  };

  return (
    <article className="product-card group relative flex h-full flex-col">
      <Link to={`/product/${product.id}`} className="block">
        <div className={`product-card-media relative overflow-hidden bg-neutral-100 ${mediaRadius}`}>
          <img
            src={shown}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className={`${mediaRatio} w-full object-cover transition-opacity duration-300`}
          />

          {/* عکس دوم هنگام hover */}
          <img
            src={gallery[(idx + 1) % gallery.length]}
            alt=""
            loading="lazy"
            aria-hidden="true"
            className={`absolute inset-0 ${mediaRatio} w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
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
            className="product-glass-control absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur transition hover:bg-white"
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
                className="product-glass-control absolute right-1.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 opacity-0 transition group-hover:opacity-100 lg:flex"
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
                className="product-glass-control absolute left-1.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 opacity-0 transition group-hover:opacity-100 lg:flex"
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

      <div className={`product-card-content mt-2.5 flex flex-1 flex-col ${cardSettings.contentAlign === "center" ? "text-center" : "text-right"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/product/${product.id}`} className="block truncate text-[12.5px] font-medium hover:underline">
              {product.name}
            </Link>
            {cardSettings.showSubtitle ? <p className="truncate text-[11.5px] text-neutral-500">{product.subtitle}</p> : null}
          </div>
          <span className="shrink-0 text-left text-[12.5px] num-fa">{salePrice < product.price ? <><span className="block text-[9px] text-neutral-400 line-through">{toman(product.price)}</span><span className="text-red-700">{toman(salePrice)}</span></> : toman(product.price)}</span>
        </div>

        {/* سوآچ رنگ‌ها */}
        {(cardSettings.showColors || cardSettings.showCompare) ? <div className={`mt-2 flex items-center gap-1.5 ${cardSettings.contentAlign === "center" ? "justify-center" : ""}`}>
          {cardSettings.showColors ? <>
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
          </> : null}

          {!compact && cardSettings.showCompare && (
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
        </div> : null}

        {isInstallmentAvailable(channel) && cardSettings.showInstallment && installment.enabled && installment.showOnCard ? <div className="mt-2 border-r-2 border-[#ffd200] pr-2 text-[9.5px] leading-5 text-neutral-500"><span className="font-medium text-[#011c3a]">{installment.provider === "digipay" ? "دیجی‌پی" : installment.provider === "both" ? "اسنپ‌پی / دیجی‌پی" : "اسنپ‌پی"}</span> · {installment.installments.toLocaleString("fa-IR")} قسط از {toman(Math.ceil(installmentPrice/installment.installments))}</div> : null}

        {cardSettings.showQuickAdd ? <div className="product-card-purchase mt-auto pt-4">
          {sizeOpen && (
            <div className="product-card-size-picker no-scrollbar mb-2.5 flex gap-1.5 overflow-x-auto" role="group" aria-label="انتخاب سایز محصول">
                {product.sizes.filter((size) => size.inStock).map((size) => (
                  <button
                    key={size.label}
                    type="button"
                    aria-pressed={selectedSize === size.label}
                    onClick={() => setSelectedSize(size.label)}
                    className={
                      "product-size-option text-[10.5px] " +
                      (selectedSize === size.label ? "is-selected" : "")
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
            style={{ "--card-hover-bg": builder.productCard.hoverBg, "--card-hover-text": builder.productCard.hoverText } as React.CSSProperties}
            className={
              "product-card-action flex h-10 w-full items-center justify-center gap-2 rounded-full text-[11.5px] font-medium transition active:scale-[0.99] " +
              (selectedSize
                ? "storefront-primary-action"
                : "storefront-secondary-action")
            }
          >
            {selectedSize && <Icon name="bag" className="h-3.5 w-3.5" />}
            {selectedSize ? `خرید سریع · سایز ${selectedSize}` : "انتخاب سایز"}
          </button>
        </div> : null}
      </div>
    </article>
  );
}
