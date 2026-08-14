import { useEffect, useState } from "react";
import Icon from "./Icon";

export default function PromoPopup() {
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("kv_promo_seen")) return;
    const t = setTimeout(() => setShow(true), 20000);
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    sessionStorage.setItem("kv_promo_seen", "1");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/45" onClick={close} />
      <div className="fade-up relative grid w-full max-w-2xl overflow-hidden rounded-[3px] bg-white sm:grid-cols-2">
        <img src="/images/detail-collar.jpg" alt="" className="hidden h-full w-full object-cover sm:block" loading="lazy" />
        <div className="p-7">
          <button onClick={close} aria-label="بستن" className="absolute left-3 top-3 text-neutral-400 hover:text-[#011c3a]">
            <Icon name="close" className="h-4 w-4" />
          </button>

          {done ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
              <p className="text-[14px] font-medium">کد تخفیف شما</p>
              <p className="rounded-[3px] border border-dashed border-[#011c3a] px-5 py-2 text-[15px] font-medium tracking-widest">
                KOLBE10
              </p>
              <p className="text-[11.5px] text-neutral-500">به ایمیل شما هم ارسال شد.</p>
            </div>
          ) : (
            <>
              <p className="text-[10.5px] tracking-[0.3em] text-neutral-400">WELCOME</p>
              <h3 className="mt-3 text-[19px] font-medium leading-snug">
                ۱۰٪ تخفیف
                <br />
                اولین خرید شما
              </h3>
              <p className="mt-3 text-[12px] leading-relaxed text-neutral-600">
                عضو خبرنامه کلبه وینتیج شوید و کد تخفیف اولین خرید را دریافت کنید.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) setDone(true);
                }}
                className="mt-5"
              >
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ایمیل شما"
                  className="h-10 w-full rounded-[3px] border border-neutral-300 px-3 text-[12.5px] outline-none focus:border-[#011c3a]"
                />
                <button className="mt-2.5 h-10 w-full rounded-[3px] bg-[#011c3a] text-[12.5px] font-medium text-white">
                  دریافت کد تخفیف
                </button>
              </form>
              <button onClick={close} className="mt-3 w-full text-[11px] text-neutral-400 hover:underline">
                فعلاً نه، ممنون
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
