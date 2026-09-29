import { useState } from "react";

import type { Product } from "../data/catalog";
import Icon from "./Icon";

type Build = "slim" | "regular" | "athletic" | "full";

const builds: { id: Build; label: string; shift: number }[] = [
  { id: "slim", label: "لاغر", shift: -1 },
  { id: "regular", label: "معمولی", shift: 0 },
  { id: "athletic", label: "ورزشکاری", shift: 0.5 },
  { id: "full", label: "تنومند", shift: 1 },
];

function BuildShape({ id, active }: { id: Build; active: boolean }) {
  const widths: Record<Build, { s: number; w: number }> = {
    slim: { s: 12, w: 9 },
    regular: { s: 15, w: 12 },
    athletic: { s: 18, w: 11 },
    full: { s: 19, w: 17 },
  };
  const { s, w } = widths[id];
  const stroke = active ? "currentColor" : "#9aa5ad";
  return (
    <svg viewBox="0 0 40 56" className="h-14 w-10">
      <circle cx="20" cy="8" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />
      <path
        d={`M${20 - s} 20 Q20 15 ${20 + s} 20 L${20 + w} 40 Q20 44 ${20 - w} 40 Z`}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d={`M${20 - w + 2} 42 L${20 - w + 3} 54 M${20 + w - 2} 42 L${20 + w - 3} 54`} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function SizeAdvisor({
  product,
  onPick,
}: {
  product: Product;
  onPick: (size: string) => void;
}) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [age, setAge] = useState("");
  const [usual, setUsual] = useState("");
  const [build, setBuild] = useState<Build>("regular");
  const [result, setResult] = useState<{ relaxed: string; fitted: string; note: string } | null>(null);

  const scale = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

  const compute = () => {
    const h = Number(height);
    const w = Number(weight);
    if (!h || !w) return;

    const bmi = w / Math.pow(h / 100, 2);
    let idx = 2; // M
    if (bmi < 19) idx = 1;
    else if (bmi < 22) idx = 2;
    else if (bmi < 25.5) idx = 3;
    else if (bmi < 29) idx = 4;
    else if (bmi < 33) idx = 5;
    else idx = 6;

    if (h > 188) idx += 0.5;
    if (h < 168) idx -= 0.5;
    idx += builds.find((b) => b.id === build)!.shift;

    if (usual) {
      const u = scale.indexOf(usual);
      if (u >= 0) idx = (idx + u) / 2;
    }

    const fittedIdx = Math.max(0, Math.min(6, Math.round(idx)));
    const relaxedIdx = Math.max(0, Math.min(6, Math.round(idx + 0.6)));

    const inStock = (s: string) => product.sizes.find((x) => x.label === s)?.inStock;

    setResult({
      fitted: scale[fittedIdx],
      relaxed: scale[relaxedIdx],
      note:
        !inStock(scale[fittedIdx]) && !inStock(scale[relaxedIdx])
          ? "متأسفانه سایز پیشنهادی این محصول موجود نیست."
          : product.sizeAdvice,
    });
  };

  return (
    <div className="size-advisor-panel rounded-2xl border border-neutral-200 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon name="user" className="h-4 w-4" />
        <h4 className="text-[13px] font-medium">پیشنهاد هوشمند سایز</h4>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">
        قد و وزن خود را وارد کنید تا مناسب‌ترین سایز را پیشنهاد دهیم.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="mb-1 block text-[11px] text-neutral-600">قد (سانتی‌متر)</span>
          <input
            inputMode="numeric"
            value={height}
            onChange={(e) => setHeight(e.target.value.replace(/\D/g, ""))}
            placeholder="۱۷۸"
            className="advisor-input h-10 w-full rounded-xl border border-neutral-300 px-3 text-[12.5px] outline-none focus:border-[#011c3a]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-neutral-600">وزن (کیلوگرم)</span>
          <input
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value.replace(/\D/g, ""))}
            placeholder="۷۵"
            className="advisor-input h-10 w-full rounded-xl border border-neutral-300 px-3 text-[12.5px] outline-none focus:border-[#011c3a]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-neutral-600">سن (اختیاری)</span>
          <input
            inputMode="numeric"
            value={age}
            onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))}
            placeholder="۳۲"
            className="advisor-input h-10 w-full rounded-xl border border-neutral-300 px-3 text-[12.5px] outline-none focus:border-[#011c3a]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-neutral-600">سایز معمول شما</span>
          <select
            value={usual}
            onChange={(e) => setUsual(e.target.value)}
            className="advisor-input h-10 w-full rounded-xl border border-neutral-300 px-2 text-[12.5px] outline-none focus:border-[#011c3a]"
          >
            <option value="">نمی‌دانم</option>
            {scale.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-2 block text-[11px] text-neutral-600">فرم بدن</span>
        <div className="grid grid-cols-4 gap-2">
          {builds.map((b) => (
            <button
              key={b.id}
              onClick={() => setBuild(b.id)}
              className={
                "advisor-build flex flex-col items-center gap-1 rounded-xl border py-2 transition " +
                (build === b.id ? "is-selected" : "border-neutral-300 hover:border-neutral-400")
              }
            >
              <BuildShape id={b.id} active={build === b.id} />
              <span className={"text-[10.5px] " + (build === b.id ? "font-medium" : "text-neutral-500")}>
                {b.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={compute}
        disabled={!height || !weight}
        className="storefront-primary-action mt-4 h-11 w-full rounded-full text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
      >
        پیشنهاد سایز به من
      </button>

      {result && (
        <div className="advisor-result fade-up mt-4 rounded-2xl border border-neutral-200 p-4">
          <p className="text-[11.5px] text-neutral-500">بر اساس اطلاعات شما:</p>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {[
              { label: "فیت تنگ‌تر", size: result.fitted },
              { label: "فیت راحت‌تر", size: result.relaxed },
            ].map((r) => {
              const available = product.sizes.find((s) => s.label === r.size)?.inStock;
              return (
                <button
                  key={r.label}
                  disabled={!available}
                  onClick={() => onPick(r.size)}
                  className="storefront-secondary-action rounded-xl border border-neutral-300 p-3 text-center transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="block text-[10.5px] text-neutral-500">{r.label}</span>
                  <span className="mt-1 block text-[18px] font-medium">{r.size}</span>
                  <span className="mt-1 block text-[10px] text-neutral-400">
                    {available ? "انتخاب کن" : "ناموجود"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">{result.note}</p>
        </div>
      )}
    </div>
  );
}
