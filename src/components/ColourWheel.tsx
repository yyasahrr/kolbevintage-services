import { colours } from "../data";

const SIZE = 260;
const C = SIZE / 2;
const R_OUT = 124;
const R_IN = 68;

function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function sector(start: number, end: number) {
  const [x1, y1] = polar(R_OUT, start);
  const [x2, y2] = polar(R_OUT, end);
  const [x3, y3] = polar(R_IN, end);
  const [x4, y4] = polar(R_IN, start);
  return `M${x1} ${y1} A${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${R_IN} ${R_IN} 0 0 0 ${x4} ${y4} Z`;
}

export default function ColourWheel({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  const step = 360 / colours.length;
  const sel = colours.find((c) => c.name === selected);

  return (
    <div className="relative mx-auto w-[260px] select-none">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full">
        {colours.map((c, i) => {
          const start = i * step + 0.9;
          const end = (i + 1) * step - 0.9;
          const isSel = c.name === selected;
          return (
            <g key={c.name} onClick={() => onSelect(c.name)} className="cursor-pointer">
              <path
                d={sector(start, end)}
                fill={c.hex}
                stroke={isSel ? "#011c3a" : "rgba(0,0,0,0.08)"}
                strokeWidth={isSel ? 2 : 0.6}
                className="transition-opacity hover:opacity-75"
              >
                <title>{c.name}</title>
              </path>
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] leading-tight text-[#011c3a]">Available colours</span>
        <span className="mt-1 max-w-[90px] text-[11px] font-medium leading-tight text-neutral-500">
          {sel?.name}
        </span>
      </div>
    </div>
  );
}
