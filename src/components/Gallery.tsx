const items = [
  { src: "/images/flat.jpg", alt: "The Heritage Polo in Navy Harbour, flat" },
  {
    src: "/images/model-front.jpg",
    alt: "Model wearing The Heritage Polo",
    caption: "Adam is 188 cm tall and wearing a size L.",
  },
  { src: "/images/model-full.jpg", alt: "Full length", shop: true },
  { src: "/images/model-teal.jpg", alt: "Studio shot", shop: true },
  { src: "/images/detail-collar.jpg", alt: "Collar detail" },
  { src: "/images/detail-hem.jpg", alt: "Fabric detail" },
  { src: "/images/model-front.jpg", alt: "Detail" },
  { src: "/images/detail-collar.jpg", alt: "Detail" },
];

export default function Gallery() {
  return (
    <>
      {/* mobile: swipe carousel */}
      <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto lg:hidden">
        {items.map((it, i) => (
          <div key={i} className="relative w-full shrink-0 snap-center">
            <img src={it.src} alt={it.alt} className="aspect-[3/4] w-full object-cover" />
            {it.shop && (
              <button className="absolute bottom-4 left-4 rounded-[3px] bg-white px-4 py-2 text-[11px] font-medium shadow">
                Shop the look
              </button>
            )}
          </div>
        ))}
      </div>

      {/* desktop grid */}
      <div className="hidden grid-cols-2 gap-[3px] lg:grid">
        {items.map((it, i) => (
          <figure key={i} className="relative bg-neutral-100">
            <img src={it.src} alt={it.alt} className="aspect-[3/4] w-full object-cover" />
            {it.shop && (
              <button className="absolute bottom-4 left-4 rounded-[3px] bg-white px-4 py-2 text-[11px] font-medium shadow transition hover:bg-neutral-100">
                Shop the look
              </button>
            )}
            {it.caption && (
              <figcaption className="absolute bottom-2 left-0 w-full text-center text-[10.5px] text-neutral-500">
                {it.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </>
  );
}
