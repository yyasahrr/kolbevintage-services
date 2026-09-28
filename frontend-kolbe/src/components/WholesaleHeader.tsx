import { Link } from "../router";
import Icon from "./Icon";

type WholesaleHeaderProps = {
  backTo?: string;
  backLabel?: string;
};

export default function WholesaleHeader({
  backTo = "/",
  backLabel = "بازگشت",
}: WholesaleHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/95 backdrop-blur-md">
      <div className="relative mx-auto flex min-h-[66px] max-w-[1600px] items-center px-4 sm:px-6">
        <Link
          to={backTo}
          aria-label={backLabel}
          className="inline-flex min-h-10 items-center gap-2 px-1 text-[11.5px] text-neutral-600 transition hover:text-[#011c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2"
        >
          <Icon name="arrowLeft" className="h-4 w-4 rotate-180" />
          <span>{backLabel}</span>
        </Link>

        <Link
          to="/"
          aria-label="صفحه اصلی کلبه وینتیج"
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-4"
        >
          <span className="whitespace-nowrap text-[17px] font-semibold tracking-[0.14em] sm:text-[19px]">
            کلبه وینتیج
          </span>
          <span className="mt-[3px] whitespace-nowrap text-[7px] tracking-[0.34em] text-neutral-400 sm:text-[8px] sm:tracking-[0.38em]">
            KOLBE VINTAGE
          </span>
        </Link>
      </div>
    </header>
  );
}
