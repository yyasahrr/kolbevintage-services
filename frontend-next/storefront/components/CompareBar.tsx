import { Link } from "../router";
import { useStore } from "../store";
import { productById } from "../data/catalog";
import { fa } from "../utils/format";
import Icon from "./Icon";

export default function CompareBar() {
  const { compare, toggleCompare, clearCompare } = useStore();
  if (compare.length === 0) return null;

  return (
    <div className="compare-bar liquid-surface fixed bottom-0 left-0 right-0 z-[85] border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 lg:px-6">
        <span className="hidden shrink-0 text-[12px] font-medium sm:block">
          مقایسه ({fa(compare.length)})
        </span>
        <div className="flex flex-1 gap-2 overflow-x-auto no-scrollbar">
          {compare.map((id) => {
            const p = productById(id);
            if (!p) return null;
            return (
              <div key={id} className="relative shrink-0">
                <img src={p.images[0]} alt={p.name} className="h-14 w-11 object-cover" loading="lazy" />
                <button
                  onClick={() => toggleCompare(id)}
                  aria-label="حذف"
                  className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#011c3a] text-white"
                >
                  <Icon name="close" className="h-2.5 w-2.5" strokeWidth={2.5} />
                </button>
              </div>
            );
          })}
        </div>
        <button onClick={clearCompare} className="shrink-0 text-[11.5px] text-neutral-500 hover:underline">
          پاک کردن
        </button>
        <Link
          to="/compare"
          className="shrink-0 rounded-[3px] bg-[#011c3a] px-4 py-2 text-[12px] font-medium text-white"
        >
          مقایسه کن
        </Link>
      </div>
    </div>
  );
}
