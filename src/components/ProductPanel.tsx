import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { accordions, colours, sizes } from "../data";
import ColourWheel from "./ColourWheel";
import SizeGuide from "./SizeGuide";
import ProductSpecs from "./ProductSpecs";

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[1px]" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={i <= Math.round(value) ? "fill-[#011c3a]" : "fill-neutral-300"}
        >
          <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
        </svg>
      ))}
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="mt-[3px] h-3 w-3 shrink-0 stroke-[#011c3a]" fill="none" strokeWidth="3">
      <path d="M4 12.5l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProductDetails({ colour }: { colour: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const hex = colours.find((c) => c.name === colour)?.hex ?? "#6fa4d8";

  return (
    <section className="border-t border-neutral-200 bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8 lg:py-16">
        <div>
          <h2 className="text-[18px] font-medium">Product details</h2>
          <ul className="mt-5 space-y-2 text-[12.5px] text-[#011c3a]">
            {[
              "Orders will be delivered within 8 business day(s)",
              "Shipping to All other countries is €35",
              "Returns & exchanges within 100 days",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check />
                <span>{t}</span>
              </li>
            ))}
            <li className="flex gap-2">
              <Check />
              <span>
                Find your Kolbe Vintage store:{" "}
                <a href="#" className="underline">
                  Check in-store availability
                </a>
              </span>
            </li>
          </ul>

          <div className="mt-8 border-t border-neutral-200">
            {accordions.map((a) => (
              <div key={a.title} className="border-b border-neutral-200">
                <button
                  onClick={() => setOpen(open === a.title ? null : a.title)}
                  className="flex w-full items-center justify-between py-3.5 text-left text-[13px]"
                >
                  {a.title}
                  <span className="text-neutral-400">{open === a.title ? "−" : "+"}</span>
                </button>
                {open === a.title && (
                  <p className="pb-4 pr-4 text-[12.5px] leading-relaxed text-neutral-600">{a.body}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 space-y-4">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#011c3a" strokeWidth="1.3">
                  <path d="M9 11V7a3 3 0 1 1 6 0v4M5 11h14l-1 10H6L5 11Z" />
                </svg>
              </div>
              <div>
                <p className="text-[12px] font-medium">Handmade in Portugal</p>
                <p className="text-[11.5px] leading-relaxed text-neutral-500">
                  Kolbe Vintage garments are crafted by hand using the highest quality materials.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#011c3a" strokeWidth="1.3">
                  <path d="M12 21c-5-3-8-7-8-11a8 8 0 0 1 16 0c0 4-3 8-8 11ZM12 3v18" />
                </svg>
              </div>
              <div>
                <p className="text-[12px] font-medium">Organic cotton</p>
                <p className="text-[11.5px] leading-relaxed text-neutral-500">
                  This product is made with organic cotton.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2 text-[11px] text-neutral-500">
            <span
              className="inline-block h-3 w-3 rounded-full border border-neutral-300"
              style={{ background: hex }}
            />
            Currently viewing: {colour}
          </div>
        </div>

        <div>
          <ProductSpecs />
        </div>
      </div>
    </section>
  );
}

export default function ProductPanel({
  colour,
  onColourChange,
}: {
  colour: string;
  onColourChange: (name: string) => void;
}) {
  const [size, setSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [fav, setFav] = useState(false);
  const [showStickyPurchase, setShowStickyPurchase] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const updateStickyPurchase = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const actions = actionsRef.current;
        if (!actions) return;
        setShowStickyPurchase(actions.getBoundingClientRect().bottom < 96);
      });
    };

    updateStickyPurchase();
    window.addEventListener("scroll", updateStickyPurchase, { passive: true });
    window.addEventListener("resize", updateStickyPurchase);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateStickyPurchase);
      window.removeEventListener("resize", updateStickyPurchase);
    };
  }, []);

  const addToCart = () => setAdded(true);

  return (
    <div className="px-5 pb-8 pt-6 lg:px-8 lg:pt-8 lg:pb-10">
      <div className="mx-auto max-w-[420px] lg:mx-0">
        <nav className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <a href="#" className="hover:underline">
            Tops
          </a>
          <span>›</span>
          <a href="#" className="hover:underline">
            Polos
          </a>
          <span>›</span>
          <span className="text-[#011c3a]">The Heritage Polo</span>
        </nav>

        <div className="mt-3 flex items-start justify-between gap-4">
          <h1 className="text-[26px] font-medium leading-none tracking-tight">{colour}</h1>
          <span className="pt-1 text-[15px]">€79</span>
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <p className="text-[12px] text-neutral-500">To see and be seen.</p>
          <div className="flex items-center gap-1.5">
            <Stars value={4.7} />
            <span className="text-[11px] text-neutral-500">(68 Reviews)</span>
          </div>
        </div>

        <div className="mt-6">
          <ColourWheel selected={colour} onSelect={onColourChange} />
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[12px] font-medium">Select your size</span>
          <SizeGuide defaultView="chart" variant="link" onRecommend={setSize} />
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {sizes.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={
                "h-9 rounded-[3px] border text-[12px] transition " +
                (size === s
                  ? "border-[#011c3a] bg-[#011c3a] text-white"
                  : "border-neutral-300 text-[#011c3a] hover:border-[#011c3a]")
              }
            >
              {s}
            </button>
          ))}
        </div>

        <div ref={actionsRef} className="mt-4">
          <div className="flex gap-2">
            <button
              onClick={addToCart}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0" />
              </svg>
              {added ? (size ? `Added - size ${size}` : "Added to cart") : "Add to cart"}
            </button>
            <button
              onClick={() => setFav(!fav)}
              aria-label="Add to wishlist"
              className="flex h-11 w-11 items-center justify-center rounded-[3px] border border-neutral-300 hover:border-[#011c3a]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill={fav ? "#011c3a" : "none"}
                stroke="#011c3a"
                strokeWidth="1.5"
              >
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z" />
              </svg>
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <SizeGuide defaultView="recommend" variant="button" onRecommend={setSize} />
            <button
              type="button"
              disabled
              title="Coming soon"
              className="group relative flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-[3px] border border-neutral-300 bg-neutral-50 text-[12px] font-medium text-neutral-400"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 5h16v14H4zM8 9h8M8 13h5" />
              </svg>
              Try on me
              <span className="absolute -top-2 right-2 rounded-sm bg-neutral-200 px-1.5 py-0.5 text-[8px] font-normal uppercase tracking-wide text-neutral-500">
                Soon
              </span>
            </button>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 text-[11.5px] text-[#011c3a]">
          {[
            "Orders will be delivered within 8 business day(s)",
            "Returns & exchanges within 100 days",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <Check />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      {showStickyPurchase &&
        createPortal(
          <div className="sticky-purchase-in fixed inset-x-0 bottom-0 z-[90] border-t border-neutral-200 bg-white/95 px-3 py-3 shadow-[0_-8px_25px_rgba(1,28,58,0.10)] backdrop-blur-md sm:px-5">
            <div className="mx-auto flex max-w-[1400px] items-center gap-2 sm:gap-3">
              <div className="mr-auto hidden min-w-[170px] md:block">
                <p className="text-[13px] font-medium">The Heritage Polo - {colour}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  €79 {size ? `- selected size ${size}` : "- select a size"}
                </p>
              </div>
              <SizeGuide defaultView="recommend" variant="compact" onRecommend={setSize} />
              <button
                type="button"
                disabled
                title="Coming soon"
                className="flex h-10 min-w-0 flex-1 cursor-not-allowed items-center justify-center rounded-[3px] border border-neutral-300 bg-neutral-50 px-2 text-[11px] font-medium text-neutral-400 sm:max-w-[125px] sm:flex-none sm:px-4 sm:text-[12px]"
              >
                Try on me
              </button>
              <button
                onClick={addToCart}
                className="flex h-10 min-w-0 flex-[1.35] items-center justify-center gap-2 rounded-[3px] bg-[#011c3a] px-3 text-[11px] font-medium text-white transition hover:bg-[#0a2c55] sm:w-[220px] sm:flex-none sm:text-[13px]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0" />
                </svg>
                {added ? "Added to cart" : "Add to cart"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
