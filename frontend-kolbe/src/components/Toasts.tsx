import { useStore } from "../store";
import Icon from "./Icon";

export default function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[120] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="storefront-toast liquid-surface fade-up flex items-center gap-2 rounded-[3px] bg-[#011c3a] px-4 py-2.5 text-[12px] text-white shadow-lg"
        >
          <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} />
          {t.text}
        </div>
      ))}
    </div>
  );
}
