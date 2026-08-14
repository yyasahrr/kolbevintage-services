import { useRef } from "react";
import { related } from "../data";

export default function Related() {
  const ref = useRef<HTMLDivElement>(null);

  const scroll = (dir: number) => {
    ref.current?.scrollBy({ left: dir * 340, behavior: "smooth" });
  };

  return (
    <section className="mx-auto max-w-[1600px] px-5 py-14 lg:px-8">
      <h2 className="mb-5 text-[15px] font-medium">You may also like</h2>

      <div className="relative">
        <div
          ref={ref}
          className="no-scrollbar flex snap-x gap-3 overflow-x-auto scroll-smooth"
        >
          {[...related, ...related].map((p, i) => (
            <a
              key={i}
              href="#"
              className="group w-[62%] shrink-0 snap-start sm:w-[42%] lg:w-[23.5%]"
            >
              <div className="relative overflow-hidden bg-neutral-100">
                <img
                  src={p.img}
                  alt={p.name}
                  className="aspect-[3/4] w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
                <div className="absolute left-2 top-2 flex gap-1">
                  {p.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-[2px] bg-[#011c3a] px-2 py-[3px] text-[9px] font-medium uppercase tracking-wide text-white"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12.5px] font-medium">{p.name}</p>
                  <p className="text-[11.5px] text-neutral-500">{p.colour}</p>
                </div>
                <span className="text-[12.5px]">{p.price}</span>
              </div>
            </a>
          ))}
        </div>

        <button
          onClick={() => scroll(-1)}
          className="absolute -left-3 top-[38%] hidden h-9 w-9 items-center justify-center rounded-full bg-white shadow-md lg:flex"
          aria-label="Previous"
        >
          ‹
        </button>
        <button
          onClick={() => scroll(1)}
          className="absolute -right-3 top-[38%] hidden h-9 w-9 items-center justify-center rounded-full bg-white shadow-md lg:flex"
          aria-label="Next"
        >
          ›
        </button>
      </div>
    </section>
  );
}
