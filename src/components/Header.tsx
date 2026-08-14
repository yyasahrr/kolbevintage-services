import { useState } from "react";

const nav = [
  "Shorts",
  "Trousers",
  "Swims",
  "Tops",
  "Accessories",
  "Club Marvelous",
  "New arrivals",
  "Bestsellers",
  "Lookbook",
];

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"h-[18px] w-[18px] " + className}
    >
      <path d={d} />
    </svg>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white">
      {/* announcement */}
      <div className="bg-[#011c3a] text-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-center px-4 py-[6px] text-[11px] tracking-wide">
          <button className="hidden sm:block absolute left-6 opacity-60 hover:opacity-100">‹</button>
          <span>Free shipping on all orders above €35 — 100 days to return</span>
          <button className="hidden sm:block absolute right-6 opacity-60 hover:opacity-100">›</button>
        </div>
      </div>

      {/* utility bar */}
      <div className="hidden border-b border-neutral-200 lg:block">
        <div className="mx-auto flex max-w-[1600px] items-center justify-end gap-6 px-6 py-1.5 text-[11px] text-[#011c3a]">
          <a className="hover:underline" href="#">Sustainability</a>
          <a className="hover:underline" href="#">Help</a>
          <a className="hover:underline" href="#">Stores</a>
          <a className="font-medium hover:underline" href="#/supplier-apply">
            Become a supplier
          </a>
          <a className="font-medium hover:underline" href="#/partner">
            Supplier portal
          </a>
          <a className="font-medium hover:underline" href="#/admin">
            Wholesale admin
          </a>
          <button className="flex items-center gap-1.5 rounded border border-neutral-300 px-2 py-[3px] hover:bg-neutral-50">
            <span className="inline-block h-3 w-4 overflow-hidden rounded-[1px]">
              <svg viewBox="0 0 6 3" className="h-full w-full">
                <rect width="6" height="1" y="0" fill="#AE1C28" />
                <rect width="6" height="1" y="1" fill="#fff" />
                <rect width="6" height="1" y="2" fill="#21468B" />
              </svg>
            </span>
            English (EU, €)
            <span className="text-[8px]">▾</span>
          </button>
        </div>
      </div>

      {/* main bar */}
      <div className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 lg:px-6">
          <button
            className="lg:hidden"
            onClick={() => setOpen(!open)}
            aria-label="Menu"
          >
            <Icon d="M3 6h18M3 12h18M3 18h18" className="h-6 w-6" />
          </button>

          <a href="#" className="mx-auto lg:mx-0 lg:absolute lg:left-1/2 lg:-translate-x-1/2">
            <span className="whitespace-nowrap text-[20px] font-semibold tracking-[0.28em] text-[#011c3a] lg:text-[22px]">
              MR MARVIS
            </span>
          </a>

          <div className="flex items-center gap-4 lg:gap-5">
            <button aria-label="Search" className="hover:opacity-60">
              <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />
            </button>
            <button aria-label="Account" className="hidden hover:opacity-60 sm:block">
              <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
            </button>
            <button aria-label="Wishlist" className="hidden hover:opacity-60 sm:block">
              <Icon d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z" />
            </button>
            <button aria-label="Cart" className="relative hover:opacity-60">
              <Icon d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0" />
            </button>
          </div>
        </div>

        {/* nav row */}
        <nav className="hidden justify-center gap-7 pb-2 text-[13px] text-[#011c3a] lg:flex">
          {nav.map((n) => (
            <a
              key={n}
              href="#"
              className="border-b border-transparent pb-1 transition hover:border-[#011c3a]"
            >
              {n}
            </a>
          ))}
        </nav>
      </div>

      {open && (
        <div className="border-b border-neutral-200 bg-white lg:hidden">
          <div className="flex flex-col px-5 py-3 text-[15px]">
            {nav.map((n) => (
              <a key={n} href="#" className="border-b border-neutral-100 py-2.5">
                {n}
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
