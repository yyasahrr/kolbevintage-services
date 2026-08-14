import { cn } from "@/utils/cn";

export function ActionButton({
  children,
  onClick,
  variant = "secondary",
  disabled,
  testId,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  testId?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      data-testid={testId}
      title={title}
      className={cn(
        "whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:focus-visible:outline-sky-400",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" &&
          "bg-navy text-white hover:bg-navy/90 dark:bg-sky-500/20 dark:text-sky-200 dark:hover:bg-sky-500/30",
        variant === "secondary" &&
          "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
        variant === "danger" &&
          "border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/50",
      )}
    >
      {children}
    </button>
  );
}
