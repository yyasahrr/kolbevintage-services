import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { guideTable } from "../dataSpecs";

type View = "chart" | "recommend";

type SizeGuideProps = {
  defaultView?: View;
  variant?: "link" | "button" | "compact";
  onRecommend?: (size: string) => void;
};

const orderedSizes = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

function RulerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="7" width="20" height="10" rx="1" />
      <path d="M7 7v6M12 7v4M17 7v6" />
    </svg>
  );
}

export default function SizeGuide({
  defaultView = "chart",
  variant = "link",
  onRecommend,
}: SizeGuideProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(defaultView);
  const [unit, setUnit] = useState<"CM" | "IN">("CM");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [age, setAge] = useState("");
  const [body, setBody] = useState("average");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function openGuide() {
    setView(defaultView);
    setSuggestion(null);
    setError("");
    setOpen(true);
  }

  function computeRecommendation() {
    const heightCm = Number(height);
    const weightKg = Number(weight);

    if (heightCm < 140 || heightCm > 220 || weightKg < 40 || weightKg > 180) {
      setError("Please enter a valid height and weight.");
      setSuggestion(null);
      return;
    }

    // Weight establishes the baseline; height and body shape fine-tune the fit.
    let index = weightKg < 55 ? 0 : weightKg < 65 ? 1 : weightKg < 77 ? 2 : weightKg < 89 ? 3 : weightKg < 103 ? 4 : weightKg < 118 ? 5 : 6;
    if (heightCm >= 190 && index < 5) index += 1;
    if (heightCm < 165 && index > 0) index -= 1;
    if (body === "muscular" || body === "relaxed") index += 1;
    if (body === "slim") index -= 1;
    index = Math.max(0, Math.min(orderedSizes.length - 1, index));

    setError("");
    setSuggestion(orderedSizes[index]);
  }

  const triggerClass =
    variant === "link"
      ? "inline-flex items-center gap-1.5 text-[12px] text-[#011c3a] underline-offset-4 hover:underline"
      : variant === "compact"
        ? "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[3px] border border-[#011c3a] px-2 text-[10.5px] font-medium text-[#011c3a] transition hover:bg-[#011c3a] hover:text-white sm:flex-none sm:gap-2 sm:px-4 sm:text-[12px]"
        : "inline-flex h-10 w-full items-center justify-center gap-2 rounded-[3px] border border-[#011c3a] text-[12px] font-medium text-[#011c3a] transition hover:bg-[#011c3a] hover:text-white";

  const modal = open ? (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#011c3a]/45 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={() => setOpen(false)}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-guide-title"
        className="relative flex max-h-[92dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-[8px] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4 sm:px-7">
          <h2 id="size-guide-title" className="text-[21px] font-semibold tracking-tight sm:text-[26px]">
            {view === "chart" ? "Guide to sizes" : "Find your best size"}
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 items-center justify-center text-[30px] font-light leading-none"
            aria-label="Close size guide"
          >
            ×
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 border-b border-neutral-200 px-5 sm:px-7">
          <button
            onClick={() => setView("chart")}
            className={`border-b-2 py-3 text-[12px] font-medium transition ${view === "chart" ? "border-[#011c3a] text-[#011c3a]" : "border-transparent text-neutral-400"}`}
          >
            Size chart
          </button>
          <button
            onClick={() => setView("recommend")}
            className={`border-b-2 py-3 text-[12px] font-medium transition ${view === "recommend" ? "border-[#011c3a] text-[#011c3a]" : "border-transparent text-neutral-400"}`}
          >
            Smart recommendation
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {view === "chart" ? (
            <>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <RulerIcon />
                  How to take measurements
                </div>
                <div className="inline-flex shrink-0 overflow-hidden rounded-[5px] bg-neutral-100 p-1">
                  {(["CM", "IN"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setUnit(item)}
                      className={`rounded-[3px] px-3 py-1 text-[11px] font-medium ${unit === item ? "bg-white text-[#011c3a] shadow-sm" : "text-neutral-400"}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-[7px] border border-neutral-200">
                <table className="w-full min-w-[650px] text-[12px]">
                  <thead className="bg-[#f5f4f1] text-neutral-700">
                    <tr>
                      <th className="px-4 py-4 text-left font-semibold">The Classic Polo</th>
                      <th className="px-4 py-4 text-center font-semibold">Length</th>
                      <th className="px-4 py-4 text-center font-semibold">Shoulder width</th>
                      <th className="px-4 py-4 text-center font-semibold">Chest</th>
                      <th className="px-4 py-4 text-center font-semibold">Sleeve length</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {guideTable.map((row, index) => {
                      const convert = (value: string) => unit === "IN" ? (Number(value) / 2.54).toFixed(1) : value;
                      return (
                        <tr key={row.size} className={index % 2 ? "bg-[#f8f7f5]" : "bg-white"}>
                          <th className="border-r border-neutral-200 px-4 py-4 text-center font-semibold">{row.size}</th>
                          <td className="px-4 py-4 text-center">{convert(row.length)}</td>
                          <td className="px-4 py-4 text-center">{convert(row.shoulders)}</td>
                          <td className="px-4 py-4 text-center">{convert(row.chest)}</td>
                          <td className="px-4 py-4 text-center">{convert(row.sleeve)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-5 text-[12px] leading-relaxed text-neutral-500">
                Our products are handmade and measurements may vary slightly from those shown above.
              </p>
            </>
          ) : (
            <div className="mx-auto max-w-[560px]">
              <p className="text-[13px] leading-relaxed text-neutral-600">
                Tell us about yourself and we will recommend the size with the most comfortable fit for this polo.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-[12px] font-medium">
                  Height <span className="text-red-600">*</span>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      min="140"
                      max="220"
                      value={height}
                      onChange={(event) => setHeight(event.target.value)}
                      placeholder="e.g. 182"
                      className="h-11 w-full rounded-[4px] border border-neutral-300 px-3 pr-10 font-normal outline-none focus:border-[#011c3a]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-normal text-neutral-400">cm</span>
                  </div>
                </label>
                <label className="text-[12px] font-medium">
                  Weight <span className="text-red-600">*</span>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      min="40"
                      max="180"
                      value={weight}
                      onChange={(event) => setWeight(event.target.value)}
                      placeholder="e.g. 78"
                      className="h-11 w-full rounded-[4px] border border-neutral-300 px-3 pr-10 font-normal outline-none focus:border-[#011c3a]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-normal text-neutral-400">kg</span>
                  </div>
                </label>
                <label className="text-[12px] font-medium">
                  Age <span className="font-normal text-neutral-400">(optional)</span>
                  <input
                    type="number"
                    min="16"
                    max="100"
                    value={age}
                    onChange={(event) => setAge(event.target.value)}
                    placeholder="e.g. 32"
                    className="mt-2 h-11 w-full rounded-[4px] border border-neutral-300 px-3 font-normal outline-none focus:border-[#011c3a]"
                  />
                </label>
                <label className="text-[12px] font-medium">
                  Body shape / preferred fit
                  <select
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="mt-2 h-11 w-full rounded-[4px] border border-neutral-300 bg-white px-3 font-normal outline-none focus:border-[#011c3a]"
                  >
                    <option value="average">Average build</option>
                    <option value="slim">Slim build</option>
                    <option value="muscular">Muscular / broad shoulders</option>
                    <option value="relaxed">I prefer a relaxed fit</option>
                  </select>
                </label>
              </div>

              {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}

              <button
                onClick={computeRecommendation}
                className="mt-5 h-11 w-full rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white transition hover:bg-[#0a2c55]"
              >
                Calculate my size
              </button>

              {suggestion && (
                <div className="mt-5 border border-[#011c3a] bg-[#f3f7fa] p-5 text-center">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Your recommended size</p>
                  <p className="mt-1 text-[32px] font-semibold leading-none">{suggestion}</p>
                  <p className="mt-2 text-[11.5px] text-neutral-500">Based on your measurements and preferred fit.</p>
                  {onRecommend && (
                    <button
                      onClick={() => {
                        onRecommend(suggestion);
                        setOpen(false);
                      }}
                      className="mt-4 rounded-[3px] border border-[#011c3a] bg-white px-5 py-2 text-[12px] font-medium"
                    >
                      Select size {suggestion}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button type="button" onClick={openGuide} className={triggerClass}>
        <RulerIcon />
        {defaultView === "recommend" ? "Find my size" : "Size guide"}
      </button>
      {modal && createPortal(modal, document.body)}
    </>
  );
}