import { useState } from "react";
import { reviews } from "../data";
import { Stars } from "./ProductPanel";

const bars = [
  { label: "Size", left: "Small", mid: "As expected", right: "Large", pos: 50, value: null },
  { label: "Fit", value: "Excellent", pos: 92 },
  { label: "Quality", value: "Excellent", pos: 95 },
  { label: "Value for money", value: "Excellent", pos: 88 },
] as any[];

export default function Reviews() {
  const [page, setPage] = useState(1);

  return (
    <section className="bg-[#f6f6f4]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 lg:px-8">
        <div className="mb-6 flex justify-end gap-5 text-[12px] text-neutral-600">
          <button className="flex items-center gap-1 hover:underline">
            Sort <span className="text-[9px]">▾</span>
          </button>
          <button className="flex items-center gap-1 hover:underline">
            Filter
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
            </svg>
          </button>
        </div>

        <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-14">
          {/* summary */}
          <div>
            <div className="flex items-end gap-3">
              <span className="text-[44px] font-light leading-none">4.7</span>
              <div className="pb-1">
                <Stars value={4.7} size={14} />
                <p className="mt-1 text-[11px] text-neutral-500">Rating based on 68 reviews</p>
              </div>
            </div>

            <div className="mt-7 space-y-5">
              {bars.map((b) => (
                <div key={b.label}>
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span>{b.label}</span>
                    {b.value && <span className="text-neutral-600">{b.value}</span>}
                  </div>
                  <div className="relative mt-2 h-[3px] w-full bg-neutral-300">
                    <div
                      className="absolute left-0 top-0 h-full bg-[#011c3a]"
                      style={{ width: `${b.pos}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#011c3a]"
                      style={{ left: `${b.pos}%` }}
                    />
                  </div>
                  {b.left && (
                    <div className="mt-1.5 flex justify-between text-[10px] text-neutral-500">
                      <span>{b.left}</span>
                      <span>{b.mid}</span>
                      <span>{b.right}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* list */}
          <div>
            <ul>
              {reviews.map((r, i) => (
                <li
                  key={i}
                  className="grid grid-cols-1 gap-3 border-b border-neutral-300 py-6 sm:grid-cols-[180px_1fr]"
                >
                  <div>
                    <Stars value={r.stars} />
                    <p className="mt-1.5 text-[11.5px] text-neutral-500">{r.colour}</p>
                    <p className="text-[11.5px] text-neutral-500">{r.product}</p>
                    <p className="mt-4 text-[11.5px]">{r.author}</p>
                    <p className="text-[11px] text-neutral-500">{r.date}</p>
                  </div>
                  <p className="text-[12.5px] italic leading-relaxed text-neutral-700">
                    “{r.text}”
                  </p>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex items-center justify-between text-[11.5px] text-neutral-600">
              <span>1-5 of 68 reviews</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded border border-neutral-300 bg-white"
                >
                  ‹
                </button>
                {[1, 2, 3].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={
                      "flex h-7 w-7 items-center justify-center rounded border " +
                      (page === p
                        ? "border-[#011c3a] bg-[#011c3a] text-white"
                        : "border-neutral-300 bg-white")
                    }
                  >
                    {p}
                  </button>
                ))}
                <span className="px-1">…</span>
                <button
                  onClick={() => setPage(14)}
                  className="flex h-7 w-7 items-center justify-center rounded border border-neutral-300 bg-white"
                >
                  14
                </button>
                <button
                  onClick={() => setPage(Math.min(14, page + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded border border-neutral-300 bg-white"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
