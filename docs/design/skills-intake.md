# یادداشت ورودی اسکیل‌ها — پروژهٔ بازطراحی ظاهر کلبه وینتیج

این سند خلاصهٔ بررسی ۷ منبع اسکیل است که کاربر معرفی کرد، به‌همراه این‌که کدام قاعده در کدام بخش
از همین ریپو اعمال می‌شود. نقش این فایل: مرجع یکدستی — تا تصمیم‌های بصری بین صفحه‌ها «رانش» نکنند.

## ۱) منابع و عصارهٔ آن‌ها

### emilkowal.ski/skill — «AI Skills for Design Engineers»
اسکیل‌ها: `emil-design-eng`, `animate`, `review-animations`, `improve-animations`,
`find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `prototype`, `pick-ui-library`.

قواعدی که در این پروژه اعمال می‌شوند:
- پیش‌فرض حرکت، **کم** است؛ حرکت فقط جایی که فایدهٔ ارتباطی دارد (تأیید کنش، جهت‌دهی، پیوستگی).
- مدت‌های کوتاه (۱۲۰–۲۴۰ms برای UI روزمره، سقف ۳۰۰ms) و کروهای طبیعی (`ease-out` برای ورود، `ease-in` برای خروج).
- فقط `transform` و `opacity`؛ انیمیت‌کردن `width/height/top/left` ممنوع.
- هزینهٔ تکرار: حرکتی که کاربر روزی ۵۰ بار می‌بیند باید حذف یا کم شود — بنابراین پنل‌های کاری
  (admin/supplier) حرکت ورودی نمی‌گیرند.
- احترام به `prefers-reduced-motion` (در `app/globals.css` از قبل وجود دارد و بازنویسی می‌شود).
- ابزار «prototype» → استفاده از پنل شناور «Tweaks» برای انتخاب سریع پالت/چگالی توسط کاربر.

### ConardLi/garden-skills
اسکیل‌ها: `web-design-engineer`, `beautiful-article`, `gpt-image-2`, `kb-retriever`, `web-video-presentation`.

قواعدی که اعمال می‌شوند:
- قبل از انتخاب توکن، یک **Design Read** مکتوب (نوع artifact، مخاطب، زبان بصری، مود، پنج دیال).
- پنج دیال به‌عنوان متغیر تصمیم: `visual-variance`, `motion-intensity`, `information-density`,
  `asset-dependence`, `brand-fidelity`.
- قاعدهٔ دارایی: برای برند، **لوگو و تصویر واقعی محصول** جای CSS-سیلوئت را نمی‌گیرد.
- چک‌لیست پیش‌از‌تحویل (نبود کلاس/ایکون لوکس‌شده، نبود گرادیان بنفش‌صورتی، نبود Inter/Roboto).
- «Code ≫ Screenshots»: به‌جای حدس از اسکرین‌شات، توکن‌ها را از کد و CSS فعلی استخراج کن.

### elayadesign/ai-design-skills
اسکیل: `landing-page-design` — ترتیب و تناسب بخش‌های لندینگ، سلسله‌مراتب، یک CTA اصلی در هر
نمای دید، فاصله‌های سخاوتمندانهٔ بین بخش‌ها، و اینکه هر بخش باید یک کار انجام دهد.

### MengTo/skills
اسکیل‌های مرتبط با این کار: `clean-minimal-beige-light-mode`, `no-ai-design-slop`,
`audit-ai-design-slop`, `design-first-ui-prompting`, `framed-grid-layout`, `image-first-grid-layout`,
`beautiful-shadows`, `animation-on-scroll`, `animation-systems`, `editorial-portfolio-chapters`,
`nested-container-frames`, `light-mode-paper-technical`, `gsap`, `threejs`, `marquee-loop`.

- `clean-minimal-beige-light-mode` **نزدیک‌ترین رسیپی به عکس مرجع** است: سطوح بژ/کرم لایه‌ای،
  بوردرهای کم‌کنتراست، یک شِل قاب‌دار مرکزی، گرید ماژولار آرام، لهجهٔ رنگی فقط برای سیگنال
  (برچسب/مقدار فعال/CTA)، ممنوعیت سایهٔ سنگین و گرادیان پرصدا.
- `no-ai-design-slop` به‌عنوان **دروازهٔ غیرفعال**: هیچ انتخابی نباید «رفلکسی» باشد؛
  نزدیکی قبل از کانتینر، سلسله‌مراتب قبل از برچسب، عمق فقط وقتی مدل لایه‌ای واقعی وجود دارد.
- `beautiful-shadows` + `framed-grid-layout` → زبان سطح‌ها و قاب‌ها در فروشگاه.

### jakubkrehel/skills
اسکیل‌ها: `better-colors`, `better-typography`, `better-layout`, `better-interface`,
`better-accessibility`, `better-writing`, `interface-review`, `variant`, `break`, `explain-interface`.

- رنگ: توکن‌ها با کنتراست تأییدشده؛ متن ≥ ۴.۵:۱ و عناصر UI ≥ ۳:۱.
- تایپوگرافی: مقیاس محدود و مشخص، ارتفاع خط متناسب فارسی (که دندانه و کشیدگی دارد).
- Layout: ریتم فاصلهٔ ثابت؛ فاصلهٔ درون‌کارت ≤ فاصلهٔ بین‌کارت (قاعدهٔ ضد-فشردگی).
- `variant` → ساخت ۲–۳ واریانت موازی قبل از تثبیت نهایی، برای انتخاب کاربر.

### codeswithroh/tastemaker
اسکیل: `tastemaker` (با اسکریپت‌های قطعی) + `ideagram`.

- **حالت `study`**: استخراج «DNA» از عکس مرجع (macrostructure، آرکی‌تایپ، پروفایل رنگ) — دقیقاً همان
  کاری که این مرحله لازم دارد.
- **`extract_palette.py`**: استخراج قطعی پالت از عکس مرجع (به‌جای توصیف متنی وایب).
- **`check_contrast.py --matrix`**: تأیید ریاضی همهٔ جفت‌رنگ‌ها قبل از انتشار هر ترکیب جدید.
- **`anti_slop_scan.py` / `audit_motion.py` / `check_component_coherence.py`**: دروازه‌های مکانیکی
  بعد از بیلد (خط تیرهٔ بلند در کپی، `transition: all`، `ease-in` در UI، `scale(0)`، حرکتی که
  گیتِ `prefers-reduced-motion` ندارد).
- **Style Lock** (`.tastemaker/style-lock.md`): تثبیت توکن‌ها تا صفحه‌های بعدی از همان‌ها استفاده کنند
  — این همان چیزی است که «یکدستی در تمام نقاط سایت» را تضمین می‌کند.

### owl-listener/designer-skills
گروه‌های مفید: `design-systems` (`design-token`, `theming-system`, `motion-system`, `component-spec`,
`icon-system`, `localization-design`), `ui-design` (`color-system`, `typography-scale`, `spacing-system`,
`layout-grid`, `dark-mode-design`, `data-visualization`, `readable-measure`),
`interaction-design` (`form-design`, `loading-states`, `error-handling-ux`, `feedback-patterns`,
`navigation-patterns`, `micro-interaction-spec`), `visual-critique` (`critique-*`), `design-ops`
(`design-qa-checklist`, `handoff-spec`), `prototyping-testing` (`accessibility-test-plan`,
`heuristic-evaluation`).

- معماری توکن سه‌لایه: `primitive → semantic → component` (این لایه‌بندی جایگزین توکن‌های پراکندهٔ
  فعلی می‌شود، ولی نام‌های فعلی به‌عنوان alias نگه داشته می‌شوند تا صفحات نشکنند).
- پوشش اجباری حالت‌ها: `loading / empty / error / disabled / focus / hover / pressed / success`.
- RTL و بومی‌سازی: اعداد، تاریخ‌ها، و جهت آیکون‌ها.
- `design-qa-checklist` به‌عنوان چک‌لیست تحویل هر صفحه.

## ۲) نگاشت به کد فعلی

| لایه | فایل‌های فعلی | کاری که انجام می‌شود |
|---|---|---|
| توکن پایه | `frontend-next/app/globals.css` (`:root` → `--kv-*`)، بلوک `@theme` | بازنویسی به سه‌لایه، با alias برای نام‌های قدیمی |
| تم فروشگاه | `[data-theme="liquid"|"dark"] .storefront-shell` در `globals.css`، `storefront/theme.ts` | یکپارچه‌سازی؛ پالت «کرِم و بلوط» به‌عنوان تم پیش‌فرض روشن |
| تم‌های مدیریتی | `storefront/designSystem.ts` (`SiteTheme`, `ThemeTokens`) | توکن‌ها با همان لایهٔ پایه هم‌راستا می‌شوند |
| صفحه‌ها | `storefront/pages/*.tsx` (۳۰ صفحه)، `storefront/components/*` | بازطراحی قالبی با کلاس‌های توکن‌محور |
| پنل تأمین‌کننده | `frontend-next/public/supplier-portal/*.css` + `supplier-src/*` | هم‌راستاسازی رنگ/فونت/شعاع با توکن‌های مشترک |
| داده | `server/kolbe-api.ts`, `app/store/kolbe/[[...path]]/route.ts` | بدون دادهٔ جعلی جدید؛ همهٔ UI متصل به همین API |

## ۳) قواعد سختی که در همهٔ صفحه‌ها اعمال می‌شود

1. هیچ رنگ خارج از مجموعه‌توکن در UI (بدون «رنگ یتیم»).
2. هر جفت‌رنگ متن/پس‌زمینه ≥ ۴.۵:۱؛ عناصر رابط ≥ ۳:۱.
3. بدون `transition: all`؛ بدون انیمیت پراپرتی‌های چیدمانی؛ بدون `scale(0)`.
4. حالت خالی، بارگذاری، خطا و بدون‌دسترسی برای هر سطح داده‌ای که دارد.
5. هیچ صفحه‌ای نباید در حالت خطای بک‌اند «صفحهٔ سفید» بدهد.
6. RTL کامل با اعداد و کدهای لاتین در جایگاه داده‌ای.
7. یکدستی: پس از تثبیت Style Lock، هیچ صفحه‌ای اجازهٔ اختراع توکن جدید ندارد.
