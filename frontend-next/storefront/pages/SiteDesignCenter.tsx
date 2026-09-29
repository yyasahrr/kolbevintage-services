import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "../router";
import Icon from "../components/Icon";
import HeroStudio from "./HeroStudio";
import SiteBuilder from "./SiteBuilder";
import { defaultSiteSettings, saveSiteSettings, useSiteSettings, type HomepageMode, type SiteSettings } from "../siteSettings";
import { SortableList } from "../components/visualBuilder";

const DesignSystemStudio = lazy(() => import("./DesignSystemStudio"));
const input = "h-10 w-full rounded-[4px] border border-neutral-300 bg-white px-3 text-[12px] outline-none transition focus:border-[#011c3a] focus-visible:ring-2 focus-visible:ring-[#011c3a]/15";
const card = "rounded-[6px] border border-neutral-200 bg-white p-4";

type DesignTab = "overview" | "homepage" | "header" | "hero" | "sections" | "footer" | "typography" | "theme";

const tabs: Array<{ id: DesignTab; label: string; description: string; icon: string }> = [
  { id: "overview", label: "نمای کلی", description: "وضعیت و میان‌برهای طراحی", icon: "activity" },
  { id: "homepage", label: "حالت صفحه اصلی", description: "فروشگاه، جشنواره، لندینگ و ترتیب سکشن‌ها", icon: "activity" },
  { id: "header", label: "هدر و منو", description: "برند، رنگ، رفتار و ناوبری", icon: "menu" },
  { id: "hero", label: "Hero Studio", description: "قالب، رسانه و محتوای Hero", icon: "play" },
  { id: "sections", label: "سکشن‌ها", description: "بنر، کارت، پاپ‌آپ و کامپوننت", icon: "bag" },
  { id: "footer", label: "فوتر", description: "ستون‌ها، تماس و نمایش موبایل", icon: "minus" },
  { id: "typography", label: "فونت و تایپوگرافی", description: "فونت سایت، تیتر و بنرهای پروموشن", icon: "mail" },
  { id: "theme", label: "تم و دسته‌بندی", description: "توکن‌های بصری و فضای سایت", icon: "star" },
];

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  return <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-[4px] border border-neutral-200 px-3 py-2 transition hover:border-neutral-400"><span><span className="block text-[11.5px] font-medium">{label}</span>{hint ? <span className="mt-0.5 block text-[9.5px] text-neutral-400">{hint}</span> : null}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#011c3a]" /></label>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[10.5px] font-medium text-neutral-500">{label}</span>{children}</label>;
}

const sectionLabels: Record<string,string> = {hero:"Hero",categories:"دسته‌بندی", "new-arrivals":"جدیدترین محصولات",banner:"بنر پروموشن","best-sellers":"پرفروش‌ها","style-look":"پیشنهاد استایل",trust:"مزایا و اعتماد"};
const homePresets: Array<{mode:HomepageMode;name:string;description:string;template:SiteSettings["builder"]["homepage"]["template"];sections:string[]}> = [
  {mode:"store",name:"ویترین فروشگاه",description:"دسته‌بندی، جدیدترین‌ها و پرفروش‌ها",template:"commerce",sections:["hero","categories","new-arrivals","banner","best-sellers","style-look","trust"]},
  {mode:"festival",name:"روز جشنواره",description:"ورود سریع به محصولات و شمارنده کمپین",template:"campaign",sections:["hero","new-arrivals","best-sellers","banner","trust"]},
  {mode:"landing",name:"لندینگ حرفه‌ای",description:"روایت متمرکز برای معرفی محصول یا برند",template:"editorial",sections:["hero","banner","style-look","trust"]},
  {mode:"collection",name:"معرفی کالکشن",description:"تمرکز روی کالکشن و محصولات منتخب",template:"collection-focus",sections:["hero","new-arrivals","banner","best-sellers","trust"]},
];

function HomepageEditor({settings,persist}:{settings:SiteSettings;persist:(next:SiteSettings)=>void}){
  const homepage=settings.builder.homepage;
  const patch=(next:SiteSettings["builder"]["homepage"])=>persist({...settings,builder:{...settings.builder,homepage:next}});
  const applyPreset=(preset:(typeof homePresets)[number])=>patch({mode:preset.mode,template:preset.template,sections:preset.sections.map((type,index)=>({id:`home-${type}-${index}`,type:type as SiteSettings["builder"]["homepage"]["sections"][number]["type"],enabled:true}))});
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><div className="space-y-5"><section className={card}><h2 className="text-[14px] font-medium">تغییر سریع وضعیت صفحه اصلی</h2><p className="mt-1 text-[10.5px] text-neutral-500">با یک انتخاب، ترتیب و محتوای صفحه برای سناریوی روز عوض می‌شود.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{homePresets.map(preset=><button type="button" key={preset.mode} onClick={()=>applyPreset(preset)} className={`border p-4 text-right transition ${homepage.mode===preset.mode?'border-[#011c3a] bg-[#f3f5f7]':'border-neutral-200 hover:border-[#011c3a]'}`}><strong className="block text-[12px] font-medium">{preset.name}</strong><span className="mt-1 block text-[9.5px] leading-5 text-neutral-500">{preset.description}</span></button>)}</div></section><section className={card}><div className="flex items-center justify-between"><div><h2 className="text-[14px] font-medium">ترتیب سکشن‌ها</h2><p className="mt-1 text-[10px] text-neutral-500">برای جابه‌جایی هر سکشن آن را بکشید.</p></div></div><div className="mt-4"><SortableList items={homepage.sections} onReorder={(sections)=>patch({...homepage,sections})} renderItem={(section,index)=><div className="flex min-h-12 items-center gap-3 border border-neutral-200 bg-white px-3"><span className="cursor-grab text-neutral-300">⠿</span><span className="text-[10px] text-neutral-400">{(index+1).toLocaleString('fa-IR')}</span><strong className="text-[11px] font-medium">{sectionLabels[section.type]}</strong><label className="mr-auto flex items-center gap-2 text-[10px] text-neutral-500">نمایش<input type="checkbox" checked={section.enabled} onChange={(event)=>patch({...homepage,sections:homepage.sections.map(item=>item.id===section.id?{...item,enabled:event.target.checked}:item)})}/></label></div>}/></div></section></div><aside className="border border-neutral-200 bg-white p-4 xl:sticky xl:top-24 xl:self-start"><p className="text-[9px] text-neutral-400">پیش‌نمایش ساختار</p><div className="mt-3 space-y-1.5">{homepage.sections.filter(item=>item.enabled).map((section,index)=><div key={section.id} className={`flex items-center justify-between border px-3 text-[9.5px] ${section.type==='hero'?'h-24 bg-[#011c3a] text-white':'h-12 bg-neutral-50'}`}><span>{sectionLabels[section.type]}</span><span className="opacity-45">{(index+1).toLocaleString('fa-IR')}</span></div>)}</div><p className="mt-3 text-[9.5px] leading-5 text-neutral-500">حالت فعال: {homePresets.find(item=>item.mode===homepage.mode)?.name}</p></aside></div>;
}

function TypographyEditor({settings,persist}:{settings:SiteSettings;persist:(next:SiteSettings)=>void}){
  const typography=settings.builder.typography; const fileRef=useRef<HTMLInputElement>(null); const [error,setError]=useState("");
  const patch=(partial:Partial<typeof typography>)=>persist({...settings,builder:{...settings.builder,typography:{...typography,...partial}}});
  const upload=(file?:File)=>{if(!file)return;setError("");if(file.size>2_500_000){setError("فونت باید کمتر از ۲.۵ مگابایت باشد.");return;}const format=(file.name.split('.').pop()?.toLowerCase()||'woff2') as "woff2"|"woff"|"ttf";if(!['woff2','woff','ttf'].includes(format)){setError("فرمت مجاز WOFF2، WOFF یا TTF است.");return;}const reader=new FileReader();reader.onload=()=>patch({customFonts:[...typography.customFonts,{id:`font-${Date.now()}`,name:file.name.replace(/\.[^.]+$/,''),url:String(reader.result),format}]});reader.onerror=()=>setError("خواندن فایل فونت ناموفق بود.");reader.readAsDataURL(file);};
  const choices=[{name:"فونت پیش‌فرض",value:"inherit"},{name:"سریف ادیتوریال",value:"serif"},...typography.customFonts.map(font=>({name:font.name,value:font.name}))];
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><section className={card}><div className="flex items-start justify-between gap-3"><div><h2 className="text-[14px] font-medium">کتابخانه فونت</h2><p className="mt-1 text-[10.5px] text-neutral-500">فونت فارسی را یک بار آپلود و در سایت، تیتر و بنر استفاده کنید.</p></div><button onClick={()=>fileRef.current?.click()} className="rounded-[4px] bg-[#011c3a] px-3 py-2 text-[10.5px] text-white">آپلود فونت</button><input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,font/woff2,font/woff,font/ttf" className="sr-only" onChange={(event)=>upload(event.target.files?.[0])}/></div>{error?<p role="alert" className="mt-3 text-[10px] text-red-700">{error}</p>:null}<div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="فونت کل وب‌سایت"><select className={input} value={typography.siteFont} onChange={(event)=>patch({siteFont:event.target.value})}>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.name}</option>)}</select></Field><Field label="فونت تیترها"><select className={input} value={typography.headingFont} onChange={(event)=>patch({headingFont:event.target.value})}>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.name}</option>)}</select></Field><Field label="فونت بنرهای پروموشن"><select className={input} value={typography.promotionalFont} onChange={(event)=>patch({promotionalFont:event.target.value})}>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.name}</option>)}</select></Field></div><div className="mt-5 divide-y border-y">{typography.customFonts.map(font=><div key={font.id} className="flex items-center justify-between py-3"><div><p className="text-[11px] font-medium">{font.name}</p><p className="mt-1 text-[9px] uppercase text-neutral-400">{font.format}</p></div><button onClick={()=>patch({customFonts:typography.customFonts.filter(item=>item.id!==font.id)})} className="text-[10px] text-red-700 underline">حذف</button></div>)}{!typography.customFonts.length?<p className="py-8 text-center text-[10px] text-neutral-400">هنوز فونت اختصاصی آپلود نشده است.</p>:null}</div></section><aside className="border border-neutral-200 bg-[#f6f6f4] p-5 xl:sticky xl:top-24 xl:self-start"><p className="text-[9px] text-neutral-400">پیش‌نمایش تایپوگرافی</p><h3 className="mt-5 text-[25px] leading-[1.7]" style={{fontFamily:typography.headingFont}}>روایت یک استایل ماندگار</h3><p className="mt-3 text-[11px] leading-7" style={{fontFamily:typography.siteFont}}>پارچه‌های نجیب، رنگ‌های مکمل و جزئیاتی که با گذر زمان زیباتر می‌شوند.</p><div className="mt-6 border border-[#011c3a] bg-white p-4" style={{fontFamily:typography.promotionalFont}}><span className="text-[8px] tracking-[.2em] text-neutral-400">PROMOTION</span><p className="mt-2 text-[16px]">جشنواره کالکشن پاییز</p></div></aside></div>;
}

function HeaderEditor({ settings, persist }: { settings: SiteSettings; persist: (next: SiteSettings) => void }) {
  const header = settings.header;
  const patch = (partial: Partial<SiteSettings["header"]>) => persist({ ...settings, header: { ...header, ...partial } });
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <section className={card}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-[14px] font-medium">هویت و ابعاد هدر</h2><p className="mt-1 text-[10.5px] text-neutral-500">نام برند، ارتفاع و رنگ‌های پایه را تنظیم کنید.</p></div><button type="button" onClick={() => patch(defaultSiteSettings.header)} className="text-[10px] text-neutral-500 underline underline-offset-4">بازنشانی هدر</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="نام فارسی برند"><input className={input} value={header.brand} onChange={(event) => patch({ brand: event.target.value })} /></Field>
          <Field label="نام لاتین برند"><input dir="ltr" className={input} value={header.latinBrand} onChange={(event) => patch({ latinBrand: event.target.value })} /></Field>
          <Field label="رنگ پس‌زمینه"><input type="color" className={input + " cursor-pointer p-1"} value={header.backgroundColor} onChange={(event) => patch({ backgroundColor: event.target.value })} /></Field>
          <Field label="رنگ محتوای هدر"><input type="color" className={input + " cursor-pointer p-1"} value={header.textColor} onChange={(event) => patch({ textColor: event.target.value })} /></Field>
          <Field label="رنگ خط جداکننده"><input type="color" className={input + " cursor-pointer p-1"} value={header.borderColor} onChange={(event) => patch({ borderColor: event.target.value })} /></Field>
          <Field label="رنگ روی Hero ویدیویی"><input type="color" className={input + " cursor-pointer p-1"} value={header.videoHeroTextColor} onChange={(event) => patch({ videoHeroTextColor: event.target.value })} /></Field>
          <Field label={`ارتفاع هدر: ${header.height} پیکسل`}><input type="range" min={56} max={88} value={header.height} onChange={(event) => patch({ height: Number(event.target.value) })} className="mt-3 w-full accent-[#011c3a]" /></Field>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-[14px] font-medium">رفتار و اجزای هدر</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Toggle label="هدر چسبان" hint="هنگام اسکرول بالای صفحه بماند" checked={header.sticky} onChange={(value) => patch({ sticky: value })} />
          <Toggle label="منوی دسکتاپ" checked={header.showNavigation} onChange={(value) => patch({ showNavigation: value })} />
          <Toggle label="تغییر تم" checked={header.showThemeToggle} onChange={(value) => patch({ showThemeToggle: value })} />
          <Toggle label="جستجو" checked={header.showSearch} onChange={(value) => patch({ showSearch: value })} />
          <Toggle label="ورود کاربر" checked={header.showAccount} onChange={(value) => patch({ showAccount: value })} />
          <Toggle label="علاقه‌مندی‌ها" checked={header.showWishlist} onChange={(value) => patch({ showWishlist: value })} />
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between"><div><h2 className="text-[14px] font-medium">آیتم‌های منوی اصلی</h2><p className="mt-1 text-[10.5px] text-neutral-500">عنوان و مسیر مسیر هر آیتم را مستقیم تغییر دهید.</p></div><button type="button" onClick={() => patch({ nav: [...header.nav, { label: "آیتم جدید", to: "/" }] })} className="rounded-[4px] bg-[#011c3a] px-3 py-2 text-[10.5px] text-white">افزودن آیتم</button></div>
        <div className="mt-4 space-y-2">{header.nav.map((item, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input aria-label={`عنوان آیتم ${index + 1}`} className={input} value={item.label} onChange={(event) => patch({ nav: header.nav.map((navItem, itemIndex) => itemIndex === index ? { ...navItem, label: event.target.value } : navItem) })} /><input aria-label={`مسیر آیتم ${index + 1}`} dir="ltr" className={input} value={item.to} onChange={(event) => patch({ nav: header.nav.map((navItem, itemIndex) => itemIndex === index ? { ...navItem, to: event.target.value } : navItem) })} /><button type="button" aria-label={`حذف ${item.label}`} onClick={() => patch({ nav: header.nav.filter((_, itemIndex) => itemIndex !== index) })} className="grid h-10 w-10 place-items-center rounded-[4px] border border-neutral-200 text-red-600 hover:bg-red-50"><Icon name="trash" className="h-4 w-4" /></button></div>)}</div>
      </section>
    </div>

    <aside className="xl:sticky xl:top-24 xl:self-start">
      <div className="overflow-hidden rounded-[6px] border border-neutral-200 bg-neutral-100">
        <div className="border-b border-neutral-200 bg-white px-3 py-2 text-[10px] text-neutral-500">پیش‌نمایش هدر دسکتاپ</div>
        <div style={{ background: header.backgroundColor, color: header.textColor, borderColor: header.borderColor, minHeight: header.height }} className="flex items-center justify-between border-b px-4">
          <div className="flex flex-col leading-none"><span className="text-[13px] font-semibold">{header.brand}</span><span className="mt-1 text-[6px] tracking-[0.25em] opacity-50">{header.latinBrand}</span></div>
          <div className="hidden gap-3 text-[8px] sm:flex">{header.showNavigation ? header.nav.slice(0, 4).map((item) => <span key={item.label}>{item.label}</span>) : null}</div>
          <div className="flex gap-2"><Icon name="search" className="h-3.5 w-3.5" /><Icon name="bag" className="h-3.5 w-3.5" /></div>
        </div>
        <div className="relative h-48 overflow-hidden"><img src="/images/model-full.jpg" alt="" className="h-full w-full object-cover" /><div className="absolute inset-x-0 top-0 flex h-12 items-center justify-between bg-transparent px-4" style={{ color: header.videoHeroTextColor }}><span className="text-[10px] font-semibold">{header.brand}</span><span className="text-[8px]">هدر شفاف روی ویدیو</span></div></div>
      </div>
    </aside>
  </div>;
}

function FooterEditor({ settings, persist }: { settings: SiteSettings; persist: (next: SiteSettings) => void }) {
  const footer = settings.footer;
  const appearance = footer.appearance;
  const patch = (partial: Partial<SiteSettings["footer"]>) => persist({ ...settings, footer: { ...footer, ...partial } });
  const patchAppearance = (partial: Partial<typeof appearance>) => patch({ appearance: { ...appearance, ...partial } });
  const patchBuilderFooter = (partial: Partial<SiteSettings["builder"]["footer"]>) => persist({ ...settings, builder: { ...settings.builder, footer: { ...settings.builder.footer, ...partial } } });
  return <div className="space-y-5">
    <section className={card}><div className="flex items-center justify-between"><div><h2 className="text-[14px] font-medium">تمپلیت و پیش‌نمایش فوتر</h2><p className="mt-1 text-[10px] text-neutral-500">خبرنامه به‌صورت پیش‌فرض حذف شده است.</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-4">{([['editorial','ادیتوریال'],['minimal','مینیمال'],['commerce','فروشگاهی'],['centered','وسط‌چین']] as const).map(([id,name])=><button type="button" key={id} onClick={()=>patchAppearance({template:id})} className={`h-10 border text-[10.5px] ${appearance.template===id?'border-[#011c3a] bg-[#011c3a] text-white':'border-neutral-300'}`}>{name}</button>)}</div><div className={`mt-4 overflow-hidden border border-neutral-200 p-5 ${appearance.template==='centered'?'rounded-[18px] text-center':appearance.template==='minimal'?'rounded-none':'rounded-[6px]'}`} style={{background:appearance.backgroundColor,color:appearance.textColor}}><div className="flex items-center justify-between border-b border-current/15 pb-4"><strong className="text-[14px]">{settings.header.brand}</strong><span className="text-[8px] opacity-50">{settings.header.latinBrand}</span></div><div className={`grid gap-4 py-4 ${appearance.layout==='compact'?'grid-cols-2':'grid-cols-3'}`}>{footer.columns.slice(0,appearance.layout==='compact'?2:3).map(column=><div key={column.title}><p className="text-[9.5px] font-medium">{column.title}</p><p className="mt-2 text-[8px] leading-5 opacity-50">{column.items.slice(0,3).join(' · ')}</p></div>)}</div><p className="border-t border-current/15 pt-3 text-[7.5px] opacity-45">{footer.copyright}</p></div></section>
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[14px] font-medium">چیدمان و نمایش فوتر</h2><p className="mt-1 text-[10.5px] text-neutral-500">نسخه موبایل به‌صورت پیش‌فرض کوتاه و آکاردئونی است.</p></div><button type="button" onClick={() => patch(defaultSiteSettings.footer)} className="text-[10px] text-neutral-500 underline underline-offset-4">بازنشانی فوتر</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="تمپلیت"><select className={input} value={appearance.template} onChange={(event)=>patchAppearance({template:event.target.value as typeof appearance.template})}><option value="editorial">ادیتوریال</option><option value="minimal">مینیمال</option><option value="commerce">فروشگاهی</option><option value="centered">وسط‌چین</option></select></Field>
        <Field label="چیدمان"><select className={input} value={appearance.layout} onChange={(event) => patchAppearance({ layout: event.target.value as typeof appearance.layout })}><option value="columns">ستونی کامل</option><option value="compact">فشرده</option></select></Field>
        <Field label="رنگ پس‌زمینه"><input type="color" className={input + " cursor-pointer p-1"} value={appearance.backgroundColor} onChange={(event) => patchAppearance({ backgroundColor: event.target.value })} /></Field>
        <Field label="رنگ متن"><input type="color" className={input + " cursor-pointer p-1"} value={appearance.textColor} onChange={(event) => patchAppearance({ textColor: event.target.value })} /></Field>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Toggle label="نمایش برند" checked={appearance.showBrand} onChange={(value) => patchAppearance({ showBrand: value })} />
        <Toggle label="نمایش تماس" checked={appearance.showContact} onChange={(value) => patchAppearance({ showContact: value })} />
        <Toggle label="نمایش مجوزها" checked={appearance.showLicenses} onChange={(value) => patchAppearance({ showLicenses: value })} />
        <Toggle label="آکاردئون موبایل" hint="برای کوتاه‌شدن فوتر موبایل" checked={appearance.mobileAccordion} onChange={(value) => patchAppearance({ mobileAccordion: value })} />
      </div>
    </section>

    <section className={card}>
      <h2 className="text-[14px] font-medium">محتوا و اطلاعات تماس</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="نشانی"><textarea className={input + " min-h-20 py-2"} value={footer.address} onChange={(event) => patch({ address: event.target.value })} /></Field>
        <Field label="تلفن"><input className={input} value={footer.phone} onChange={(event) => patch({ phone: event.target.value })} /></Field>
        <Field label="ایمیل"><input dir="ltr" className={input} value={footer.email} onChange={(event) => patch({ email: event.target.value })} /></Field>
        <Field label="ساعت کاری"><input className={input} value={footer.hours} onChange={(event) => patch({ hours: event.target.value })} /></Field>
        <Field label="کپی‌رایت"><input className={input} value={footer.copyright} onChange={(event) => patch({ copyright: event.target.value })} /></Field>
      </div>
    </section>

    <section className={card}>
      <div className="flex items-center justify-between"><div><h2 className="text-[14px] font-medium">ستون‌ها و لینک‌ها</h2><p className="mt-1 text-[10.5px] text-neutral-500">هر ستون و مسیر مقصد لینک‌ها مستقل قابل ویرایش است.</p></div><button type="button" onClick={() => patch({ columns: [...footer.columns, { title: "ستون جدید", items: ["لینک جدید"] }], columnUrls: [...footer.columnUrls, ["/"]] })} className="rounded-[4px] bg-[#011c3a] px-3 py-2 text-[10.5px] text-white">افزودن ستون</button></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{footer.columns.map((column, columnIndex) => <article key={columnIndex} className="rounded-[5px] border border-neutral-200 p-3"><div className="flex gap-2"><input aria-label={`عنوان ستون ${columnIndex + 1}`} className={input} value={column.title} onChange={(event) => patch({ columns: footer.columns.map((item, index) => index === columnIndex ? { ...item, title: event.target.value } : item) })} /><button type="button" aria-label="حذف ستون" onClick={() => patch({ columns: footer.columns.filter((_, index) => index !== columnIndex), columnUrls: footer.columnUrls.filter((_, index) => index !== columnIndex) })} className="grid h-10 w-10 place-items-center text-red-600"><Icon name="trash" className="h-4 w-4" /></button></div><div className="mt-3 space-y-2">{column.items.map((item, itemIndex) => <div key={itemIndex} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input aria-label="عنوان لینک" className={input} value={item} onChange={(event) => patch({ columns: footer.columns.map((value, index) => index === columnIndex ? { ...value, items: value.items.map((label, linkIndex) => linkIndex === itemIndex ? event.target.value : label) } : value) })} /><input aria-label="مسیر لینک" dir="ltr" className={input} value={footer.columnUrls[columnIndex]?.[itemIndex] || ""} onChange={(event) => { const urls = footer.columnUrls.map((items) => [...items]); while (urls.length <= columnIndex) urls.push([]); urls[columnIndex][itemIndex] = event.target.value; patch({ columnUrls: urls }); }} /><button type="button" aria-label="حذف لینک" onClick={() => patch({ columns: footer.columns.map((value, index) => index === columnIndex ? { ...value, items: value.items.filter((_, linkIndex) => linkIndex !== itemIndex) } : value), columnUrls: footer.columnUrls.map((urls, index) => index === columnIndex ? urls.filter((_, linkIndex) => linkIndex !== itemIndex) : urls) })} className="grid h-10 w-8 place-items-center text-red-600"><Icon name="minus" className="h-3.5 w-3.5" /></button></div>)}</div><button type="button" onClick={() => patch({ columns: footer.columns.map((value, index) => index === columnIndex ? { ...value, items: [...value.items, "لینک جدید"] } : value), columnUrls: footer.columnUrls.map((urls, index) => index === columnIndex ? [...urls, "/"] : urls) })} className="mt-3 text-[10.5px] text-neutral-500 underline underline-offset-4">+ افزودن لینک</button></article>)}</div>
    </section>

    <section className={card}>
      <div className="flex items-center justify-between"><h2 className="text-[14px] font-medium">شبکه‌های اجتماعی</h2><button type="button" onClick={() => patchBuilderFooter({ socials: [...settings.builder.footer.socials, { icon: "mail", label: "شبکه جدید", url: "https://" }] })} className="text-[10.5px] underline underline-offset-4">افزودن شبکه</button></div>
      <div className="mt-3 space-y-2">{settings.builder.footer.socials.map((social, index) => <div key={index} className="grid gap-2 sm:grid-cols-[110px_1fr_1fr_auto]"><input aria-label="نام آیکن" className={input} value={social.icon} onChange={(event) => patchBuilderFooter({ socials: settings.builder.footer.socials.map((item, itemIndex) => itemIndex === index ? { ...item, icon: event.target.value } : item) })} /><input aria-label="عنوان شبکه" className={input} value={social.label} onChange={(event) => patchBuilderFooter({ socials: settings.builder.footer.socials.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /><input aria-label="آدرس شبکه" dir="ltr" className={input} value={social.url} onChange={(event) => patchBuilderFooter({ socials: settings.builder.footer.socials.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item) })} /><button type="button" aria-label={`حذف ${social.label}`} onClick={() => patchBuilderFooter({ socials: settings.builder.footer.socials.filter((_, itemIndex) => itemIndex !== index) })} className="grid h-10 w-10 place-items-center text-red-600"><Icon name="trash" className="h-4 w-4" /></button></div>)}</div>
    </section>
  </div>;
}

export default function SiteDesignCenter() {
  const settings = useSiteSettings();
  const [tab, setTab] = useState<DesignTab>("overview");
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const persist = (next: SiteSettings) => { saveSiteSettings(next); setSaved(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setSaved(false), 1400); };

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[9px] tracking-[0.22em] text-neutral-400">VISUAL SITE BUILDER</p><h1 className="mt-2 text-[20px] font-semibold tracking-tight">مرکز طراحی سایت</h1><p className="mt-1 max-w-2xl text-[11px] leading-6 text-neutral-500">تمام ابزارهای ظاهری فروشگاه، از هدر و Hero تا سکشن‌ها، فوتر و تم، در یک فضای کاری.</p></div><div className="flex items-center gap-2">{saved ? <span role="status" className="text-[10.5px] text-emerald-700">ذخیره شد</span> : null}<Link to="/" className="rounded-[4px] border border-neutral-300 bg-white px-4 py-2.5 text-[11px] hover:border-[#011c3a]">مشاهده سایت</Link></div></header>

    <nav aria-label="بخش‌های مرکز طراحی" className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-neutral-200 pb-2">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[11px] transition ${tab === item.id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-[#011c3a]"}`}><Icon name={item.icon} className="h-3.5 w-3.5" />{item.label}</button>)}</nav>

    {tab === "overview" ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tabs.filter((item) => item.id !== "overview").map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className="group rounded-[6px] border border-neutral-200 bg-white p-4 text-right transition hover:border-[#011c3a]"><span className="flex items-center justify-between"><Icon name={item.icon} className="h-5 w-5 text-[#011c3a]" /><Icon name="arrowLeft" className="h-4 w-4 text-neutral-300 transition group-hover:-translate-x-1 group-hover:text-[#011c3a]" /></span><strong className="mt-5 block text-[13px] font-medium">{item.label}</strong><span className="mt-1 block text-[10.5px] text-neutral-500">{item.description}</span></button>)}</div> : null}
    {tab === "homepage" ? <HomepageEditor settings={settings} persist={persist} /> : null}
    {tab === "header" ? <HeaderEditor settings={settings} persist={persist} /> : null}
    {tab === "hero" ? <HeroStudio /> : null}
    {tab === "sections" ? <SiteBuilder mode="sections" /> : null}
    {tab === "footer" ? <FooterEditor settings={settings} persist={persist} /> : null}
    {tab === "typography" ? <TypographyEditor settings={settings} persist={persist} /> : null}
    {tab === "theme" ? <Suspense fallback={<div className="h-64 animate-pulse rounded-[6px] bg-neutral-100" aria-label="در حال بارگذاری تنظیمات تم" />}><DesignSystemStudio /></Suspense> : null}
  </div>;
}
