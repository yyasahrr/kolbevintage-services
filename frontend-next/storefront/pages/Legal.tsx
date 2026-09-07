import { Link } from "../router";

type LegalSection = { title: string; paragraphs: string[] };

const pages: Record<string, { eyebrow: string; title: string; summary: string; sections: LegalSection[] }> = {
  terms: { eyebrow: "TERMS OF USE", title: "شرایط استفاده و خرید", summary: "قواعد ثبت سفارش، پرداخت و استفاده از خدمات فروشگاه کلبه وینتیج.", sections: [
    { title: "ثبت سفارش", paragraphs: ["ثبت سفارش به‌معنای پذیرش مشخصات کالا، قیمت نهایی و نشانی تحویل است. سفارش پس از تایید پرداخت وارد مرحله آماده‌سازی می‌شود.", "اگر موجودی یک کالا پیش از نهایی‌شدن سفارش تغییر کند، مبلغ همان قلم به روش پرداخت اولیه بازگردانده می‌شود."] },
    { title: "قیمت و پرداخت", paragraphs: ["مبلغ نمایش‌داده‌شده در سبد خرید، با احتساب تخفیف و هزینه ارسال، مبلغ نهایی قابل پرداخت است. در خرید اقساطی، شرایط و افزایش قیمت پیش از پرداخت به‌طور شفاف نمایش داده می‌شود."] },
    { title: "حساب کاربری", paragraphs: ["مسئولیت حفاظت از کد ورود و صحت اطلاعات حساب برعهده صاحب حساب است. فعالیت مشکوک می‌تواند تا بررسی امنیتی باعث محدودشدن موقت دسترسی شود."] },
  ]},
  privacy: { eyebrow: "PRIVACY", title: "حریم خصوصی", summary: "این صفحه توضیح می‌دهد چه داده‌ای جمع می‌کنیم و برای چه منظوری از آن استفاده می‌شود.", sections: [
    { title: "داده‌های مورد استفاده", paragraphs: ["اطلاعات تماس، نشانی، سوابق سفارش، ترجیحات استایل و رویدادهای ضروری فروشگاه برای انجام سفارش و بهبود پیشنهادها نگهداری می‌شوند."] },
    { title: "پیام‌های بازاریابی", paragraphs: ["ارسال پیام تبلیغاتی فقط برای مشتریانی انجام می‌شود که رضایت خود را ثبت کرده‌اند. لغو رضایت از پروفایل یا از طریق پشتیبانی ممکن است."] },
    { title: "کنترل و نگهداری", paragraphs: ["دسترسی کارکنان براساس نقش محدود می‌شود. کاربر می‌تواند برای اصلاح یا حذف داده‌های غیرالزامی با پشتیبانی تماس بگیرد؛ داده‌های مالی طبق الزامات قانونی نگهداری می‌شوند."] },
  ]},
  returns: { eyebrow: "RETURNS", title: "تعویض و مرجوعی", summary: "فرآیند روشن برای بازگرداندن یا تعویض کالای واجد شرایط.", sections: [
    { title: "مهلت و شرایط", paragraphs: ["درخواست مرجوعی تا ۳۰ روز پس از تحویل پذیرفته می‌شود؛ کالا باید استفاده‌نشده، سالم و همراه با برچسب و متعلقات باشد.", "کالاهای شخصی‌سازی‌شده و اقلام بهداشتی بازشده، جز در صورت ایراد تولید، قابل مرجوعی نیستند."] },
    { title: "روش ثبت", paragraphs: ["کد سفارش و دلیل بازگشت را از حساب کاربری یا پشتیبانی ارسال کنید. پس از تایید اولیه، راهنمای بسته‌بندی و کد بازگشت در اختیار شما قرار می‌گیرد."] },
    { title: "بازپرداخت", paragraphs: ["پس از بررسی کالا، بازپرداخت به روش پرداخت اولیه انجام می‌شود. زمان واریز نهایی ممکن است با توجه به بانک متفاوت باشد."] },
  ]},
  shipping: { eyebrow: "SHIPPING", title: "ارسال و تحویل", summary: "روش‌های ارسال، زمان آماده‌سازی و مسئولیت تحویل سفارش.", sections: [
    { title: "آماده‌سازی", paragraphs: ["سفارش‌های موجود معمولاً در یک روز کاری آماده می‌شوند. برای اقلام سفارشی، زمان دقیق در صفحه محصول و جزئیات سفارش درج می‌شود."] },
    { title: "رهگیری", paragraphs: ["پس از تحویل بسته به شرکت حمل، کد رهگیری از طریق پیامک و حساب کاربری ارسال می‌شود. تغییر نشانی پس از تحویل به حامل ممکن نیست."] },
    { title: "آسیب در حمل", paragraphs: ["در صورت آسیب ظاهری بسته، پیش از بازکردن از آن عکس بگیرید و حداکثر تا ۲۴ ساعت موضوع را به پشتیبانی اطلاع دهید."] },
  ]},
  "wholesale-terms": { eyebrow: "WHOLESALE TERMS", title: "قوانین خرید عمده و VIP", summary: "شرایط عضویت پرداخت‌شده، تامین چندفروشنده‌ای و تحویل تجمیعی سفارش عمده.", sections: [
    { title: "فعال‌سازی VIP", paragraphs: ["خریدار عمده پس از پرداخت موفق پلن انتخابی، بدون نیاز به تایید درخواست، به امکانات همان پلن دسترسی پیدا می‌کند. تعلیق فقط در صورت تخلف، برگشت وجه یا ریسک امنیتی انجام می‌شود."] },
    { title: "سفارش تجمیعی", paragraphs: ["یک سفارش ممکن است از محصولات کلبه و چند ساپلایر تامین شود. کلبه هماهنگی تامین، کنترل اقلام و ارسال تجمیعی را انجام می‌دهد و وضعیت هر بخش در سفارش قابل مشاهده است."] },
    { title: "حداقل سفارش و زمان تامین", paragraphs: ["حداقل تعداد، قیمت عمده و زمان تامین برای هر کالا مستقل است. سفارش سریع فقط برای موجودی آماده قابل انتخاب است؛ سفارش عادی می‌تواند وارد فرآیند تامین شود."] },
  ]},
};

export default function LegalPage({ page }: { page: keyof typeof pages }) {
  const content = pages[page];
  return <main className="bg-[#f6f5f1] px-4 py-10 lg:px-8 lg:py-16"><div className="mx-auto max-w-5xl"><nav className="text-[10px] text-neutral-500"><Link to="/">خانه</Link><span className="mx-2">/</span>{content.title}</nav><header className="mt-8 max-w-3xl border-b border-neutral-300 pb-10"><p className="text-[10px] tracking-[.26em] text-neutral-400">{content.eyebrow}</p><h1 className="mt-3 text-[30px] font-medium tracking-tight sm:text-[42px]">{content.title}</h1><p className="mt-4 max-w-2xl text-[13px] leading-7 text-neutral-600">{content.summary}</p><p className="mt-4 text-[9.5px] text-neutral-400">آخرین بازبینی: ۱۳ شهریور ۱۴۰۵</p></header><div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]"><aside className="h-fit border-r-2 border-[#011c3a] pr-4 text-[10px] leading-6 text-neutral-500 lg:sticky lg:top-28">این متن نسخه اجرایی اولیه است و از مرکز محتوا قابل ویرایش خواهد بود. برای پرسش درباره هر بند با پشتیبانی تماس بگیرید.</aside><article className="space-y-9">{content.sections.map((section,index)=><section key={section.title} className="grid gap-4 sm:grid-cols-[42px_1fr]"><span className="font-mono text-[11px] text-neutral-400">{String(index+1).padStart(2,"0")}</span><div><h2 className="text-[17px] font-medium">{section.title}</h2><div className="mt-3 space-y-3">{section.paragraphs.map(paragraph=><p key={paragraph} className="max-w-3xl text-[12.5px] leading-8 text-neutral-600">{paragraph}</p>)}</div></div></section>)}</article></div><footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-300 pt-6"><Link to="/contact" className="text-[11px] underline">پرسش از پشتیبانی</Link><Link to="/shop" className="bg-[#011c3a] px-5 py-3 text-[11px] text-white">بازگشت به فروشگاه</Link></footer></div></main>;
}
