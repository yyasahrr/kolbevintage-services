import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fa } from "../utils/format";
import Icon from "./Icon";

export default function Lightbox({
  images,
  start,
  onClose,
}: {
  images: string[];
  start: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") next(1);
      if (e.key === "ArrowRight") next(-1);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  });

  const next = (d: number) => {
    setZoom(1);
    setI((v) => (v + d + images.length) % images.length);
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <span className="text-[12px] text-neutral-500 num-fa">
          {fa(i + 1)} / {fa(images.length)}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setZoom((z) => (z === 1 ? 2.2 : 1))}
            className="rounded-[3px] border border-neutral-300 px-3 py-1 text-[11.5px]"
          >
            {zoom === 1 ? "بزرگ‌نمایی" : "اندازه اصلی"}
          </button>
          <button onClick={onClose} aria-label="بستن">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        className="relative flex-1 overflow-hidden bg-neutral-50"
        onMouseMove={(e) => {
          if (zoom === 1) return;
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onClick={() => setZoom((z) => (z === 1 ? 2.2 : 1))}
      >
        <img
          src={images[i]}
          alt=""
          className="h-full w-full object-contain transition-transform duration-200"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: `${pos.x}% ${pos.y}%`,
            cursor: zoom === 1 ? "zoom-in" : "zoom-out",
          }}
        />

        <button
          onClick={(e) => {
            e.stopPropagation();
            next(1);
          }}
          aria-label="بعدی"
          className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md"
        >
          <Icon name="chevronRight" className="h-5 w-5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            next(-1);
          }}
          aria-label="قبلی"
          className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md"
        >
          <Icon name="chevronLeft" className="h-5 w-5" />
        </button>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-neutral-200 px-4 py-3">
        {images.map((src, idx) => (
          <button
            key={idx}
            onClick={() => {
              setZoom(1);
              setI(idx);
            }}
            className={"shrink-0 border-2 transition " + (idx === i ? "border-[#011c3a]" : "border-transparent")}
          >
            <img src={src} alt="" className="h-16 w-12 object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
