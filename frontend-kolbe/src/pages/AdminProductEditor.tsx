import { useMemo, useRef, useState, type ReactNode } from "react";
import { categories, products, specLabels, specOrder } from "../data/catalog";
import { styles } from "../siteData";
import { type AdminProductRecord, type AdminVariant, type AdminLookHotspot, type ProductStatus } from "../adminProducts";
import { fileToOptimizedDataUrl } from "../lib/imageUpload";
import Icon from "../components/Icon";

const input="h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#011c3a]";
const secondary="h-9 border border-neutral-300 bg-white px-3 text-[10px] transition hover:border-[#011c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]";
const warehouses=["انبار مرکزی","انبار تولید","شعبه ونک"];
const tabs=[["basic","اطلاعات پایه"],["variants","تنوع و موجودی"],["media","رسانه"],["specs","مشخصات"],["size","جدول سایز"],["relations","محصولات مرتبط"],["workflow","انتشار و نسخه‌ها"]] as const;
const statusLabel:Record<ProductStatus,string>={draft:"پیش‌نویس",review:"در انتظار بررسی",published:"منتشرشده"};

export default function AdminProductEditor({ initial, onBack, onSave }: { initial:AdminProductRecord; onBack:()=>void; onSave:(record:AdminProductRecord)=>string|null }) {
  const [draft,setDraft]=useState<AdminProductRecord>(()=>structuredClone(initial)); const [tab,setTab]=useState<(typeof tabs)[number][0]>("basic");
  const [message,setMessage]=useState<{type:"success"|"error";text:string}|null>(null); const [tag,setTag]=useState(""); const [collection,setCollection]=useState(""); const [dragIndex,setDragIndex]=useState<number|null>(null); const [mediaUrl,setMediaUrl]=useState(""); const [selectedVersion,setSelectedVersion]=useState<string|null>(null);
  const errors=useMemo(()=>{const list:string[]=[];if(!draft.name.trim())list.push("نام محصول الزامی است");if(!draft.specs.code.trim())list.push("کد محصول الزامی است");if(draft.price<0)list.push("قیمت معتبر نیست");if(draft.admin.status==="published"&&!draft.images.length)list.push("محصول منتشرشده حداقل یک تصویر لازم دارد");if(draft.admin.status==="published"&&!draft.admin.variants.length)list.push("محصول منتشرشده حداقل یک تنوع لازم دارد");return list;},[draft]);
  const update=<K extends keyof AdminProductRecord>(key:K,value:AdminProductRecord[K])=>setDraft(current=>({...current,[key]:value}));
  const updateAdmin=<K extends keyof AdminProductRecord["admin"]>(key:K,value:AdminProductRecord["admin"][K])=>setDraft(current=>({...current,admin:{...current.admin,[key]:value}}));
  const save=(status?:ProductStatus)=>{const target=status?{...draft,admin:{...draft.admin,status}}:draft;setDraft(target);const currentErrors:string[]=[];if(!target.name.trim())currentErrors.push("نام محصول الزامی است");if(!target.specs.code.trim())currentErrors.push("کد محصول الزامی است");if(target.admin.status==="published"&&!target.images.length)currentErrors.push("برای انتشار تصویر اضافه کنید");if(target.admin.status==="published"&&!target.admin.variants.length)currentErrors.push("برای انتشار حداقل یک تنوع بسازید");if(currentErrors.length){setMessage({type:"error",text:currentErrors.join("؛ ")});return;}const snapshot=JSON.stringify({...target,admin:{...target.admin,versions:[]}});const version={id:`v-${Date.now()}`,at:new Intl.DateTimeFormat("fa-IR",{dateStyle:"short",timeStyle:"short"}).format(new Date()),status:target.admin.status,summary:status?`تغییر وضعیت به ${statusLabel[status]}`:"ذخیره تغییرات محصول",snapshot};const final={...target,admin:{...target.admin,versions:[version,...target.admin.versions].slice(0,20)}};const error=onSave(final);if(error){setMessage({type:"error",text:error});return;}setDraft(final);setMessage({type:"success",text:"محصول و نسخه جدید آن ذخیره شد."});};
  const addVariant=()=>{const index=draft.admin.variants.length;const item:AdminVariant={id:`variant-${Date.now()}`,colour:"سرمه‌ای",hex:"#17253b",size:"M",sku:`${draft.specs.code||"SKU"}-${index+1}`,barcode:`626${String(Date.now()).slice(-10)}`,price:draft.price,stock:0,warehouse:warehouses[0]};updateAdmin("variants",[...draft.admin.variants,item]);};
  const buildVariantTemplate=(colour:string,hex:string,sizes:string[])=>{const existing=new Set(draft.admin.variants.map(v=>`${v.colour}|${v.size}`));const additions=sizes.filter(size=>!existing.has(`${colour}|${size}`)).map((size,index)=>({id:`variant-${Date.now()}-${index}`,colour,hex,size,sku:`${draft.specs.code||"SKU"}-${colour.slice(0,2)}-${size}`.replace(/\s/g,""),barcode:`626${String(Date.now()+index).slice(-10)}`,price:draft.price,stock:0,warehouse:warehouses[0]}));syncProductOptions([...draft.admin.variants,...additions]);};
  const restoreVersion=(id:string)=>{const version=draft.admin.versions.find(v=>v.id===id);if(!version?.snapshot){setMessage({type:"error",text:"این نسخه قدیمی فاقد داده بازیابی است."});return;}try{const restored=JSON.parse(version.snapshot) as AdminProductRecord;setDraft({...restored,admin:{...restored.admin,versions:draft.admin.versions}});setSelectedVersion(null);setMessage({type:"success",text:"نسخه انتخابی بازیابی شد؛ برای ثبت نهایی آن را ذخیره کنید."});}catch{setMessage({type:"error",text:"خواندن نسخه انتخابی ممکن نیست."});}};
  const patchVariant=(id:string,patch:Partial<AdminVariant>)=>updateAdmin("variants",draft.admin.variants.map(item=>item.id===id?{...item,...patch}:item));
  const syncProductOptions=(variants:AdminVariant[])=>{const colours=[...new Map(variants.map(v=>[v.colour,{name:v.colour,hex:v.hex,img:draft.images[draft.admin.mainImage]??draft.images[0]??"/images/flat.jpg",angle:0}])).values()];const sizes=[...new Set(variants.map(v=>v.size))].map(label=>({label,inStock:variants.some(v=>v.size===label&&v.stock>0)}));setDraft(current=>({...current,colours,sizes,admin:{...current.admin,variants}}));};
  const readFiles=async(files:FileList|null)=>{if(!files?.length)return;const loaded=await Promise.all([...files].map(file=>new Promise<string>((resolve,reject)=>{if(!file.type.startsWith("image/")){reject(new Error("فقط فایل تصویر مجاز است"));return;}if(file.size>2_000_000){reject(new Error("هر تصویر باید کمتر از ۲ مگابایت باشد"));return;}const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("خواندن تصویر ناموفق بود"));reader.readAsDataURL(file);})));update("images",[...draft.images,...loaded]);};
  const addToken=(kind:"tags"|"collections",value:string,clear:()=>void)=>{const clean=value.trim();if(!clean)return;updateAdmin(kind,[...new Set([...draft.admin[kind],clean])]);clear();};
  return <div className="pb-20"><header data-testid="product-editor-toolbar" className="-mx-4 mb-5 border-y border-neutral-200 bg-white px-4 py-3 lg:-mx-6 lg:px-6"><div className="flex flex-wrap items-center gap-3"><button onClick={onBack} className={secondary}>بازگشت</button><div className="min-w-0"><h1 className="truncate text-[16px] font-medium">{draft.name||"محصول بدون نام"}</h1><p className="mt-0.5 text-[9px] text-neutral-400">{draft.specs.code} · {statusLabel[draft.admin.status]}</p></div><div className="mr-auto flex flex-wrap gap-2">{draft.admin.status==="published"&&<button onClick={()=>window.open(`${window.location.origin}${window.location.pathname}#/product/${draft.id}`,"_blank")} className={secondary}>پیش‌نمایش</button>}<button onClick={()=>save()} className={secondary}>ذخیره پیش‌نویس</button><button onClick={()=>save("review")} className={secondary}>ارسال برای بررسی</button><button onClick={()=>save("published")} className="h-9 bg-[#011c3a] px-4 text-[10px] text-white">انتشار محصول</button></div></div>{message&&<p role={message.type==="error"?"alert":"status"} className={(message.type==="error"?"border-red-200 bg-red-50 text-red-700":"border-[#b9cfbc] bg-[#edf3ee] text-[#36563a]")+" mt-3 border px-3 py-2 text-[10px]"}>{message.text}</p>}</header>
    <nav className="no-scrollbar mb-5 flex gap-2 overflow-x-auto border-b border-neutral-200 pb-3">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={(tab===id?"bg-[#011c3a] text-white":"border border-neutral-300 bg-white")+" shrink-0 px-3 py-2 text-[10.5px]"}>{label}</button>)}</nav>
    <main className="border border-neutral-200 bg-white p-4 lg:p-6">
      {tab==="basic"&&<section className="grid gap-5 xl:grid-cols-[1fr_300px]"><div className="grid gap-3 sm:grid-cols-2"><Field label="نام محصول" required><input aria-label="نام محصول" value={draft.name} onChange={e=>update("name",e.target.value)} className={input}/></Field><Field label="نام لاتین"><input aria-label="نام لاتین" value={draft.latin} onChange={e=>update("latin",e.target.value)} className={input}/></Field><Field label="زیرعنوان"><input aria-label="زیرعنوان" value={draft.subtitle} onChange={e=>update("subtitle",e.target.value)} className={input}/></Field><Field label="کد محصول" required><input aria-label="کد محصول" value={draft.specs.code} onChange={e=>update("specs",{...draft.specs,code:e.target.value})} className={input}/></Field><Field label="قیمت پایه (تومان)" required><input aria-label="قیمت پایه (تومان)" type="number" min="0" value={draft.price} onChange={e=>update("price",Number(e.target.value))} className={input}/></Field><Field label="دسته‌بندی"><select aria-label="دسته‌بندی" value={draft.category} onChange={e=>{const category=categories.find(x=>x.slug===e.target.value);setDraft(c=>({...c,category:e.target.value,categoryLabel:category?.label??c.categoryLabel}))}} className={input}>{categories.map(x=><option key={x.slug} value={x.slug}>{x.label}</option>)}</select></Field><Field label="استایل"><select aria-label="استایل" value={draft.style} onChange={e=>update("style",e.target.value)} className={input}>{styles.map(x=><option key={x.slug} value={x.slug}>{x.name}</option>)}</select></Field><Field label="فصل"><input aria-label="فصل" value={draft.season} onChange={e=>update("season",e.target.value)} className={input}/></Field><Field label="توضیحات" wide><textarea aria-label="توضیحات" rows={6} value={draft.description} onChange={e=>update("description",e.target.value)} className="w-full border border-neutral-300 p-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]"/></Field></div><aside className="space-y-5"><TokenEditor label="کالکشن‌ها" value={collection} onChange={setCollection} items={draft.admin.collections} onAdd={()=>addToken("collections",collection,()=>setCollection(""))} onRemove={x=>updateAdmin("collections",draft.admin.collections.filter(y=>y!==x))}/><TokenEditor label="تگ‌ها" value={tag} onChange={setTag} items={draft.admin.tags} onAdd={()=>addToken("tags",tag,()=>setTag(""))} onRemove={x=>updateAdmin("tags",draft.admin.tags.filter(y=>y!==x))}/><div className="border border-neutral-200 p-4"><p className="text-[10px] font-medium">آمادگی انتشار</p><ul className="mt-3 space-y-2 text-[9.5px]">{[draft.name?"نام تکمیل است":"نام ناقص است",draft.images.length?`${draft.images.length} تصویر` : "تصویر ندارد",draft.admin.variants.length?`${draft.admin.variants.length} تنوع` : "تنوع ندارد"].map((x,i)=><li key={x} className={((i===0&&draft.name)||(i===1&&draft.images.length)||(i===2&&draft.admin.variants.length)?"text-[#36563a]":"text-red-700")}>{x}</li>)}</ul></div></aside></section>}
      {tab==="variants"&&(
        <VariantsSection
          draft={draft}
          warehouses={warehouses}
          onPatchVariant={patchVariant}
          onSetVariants={syncProductOptions}
          onAddVariant={addVariant}
          onBuildTemplate={buildVariantTemplate}
          onApplyBasePrice={()=>{const next=draft.admin.variants.map(v=>({...v,price:draft.price}));syncProductOptions(next)}}
        />
      )}
      {tab==="media"&&<section><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[13px] font-medium">تصاویر محصول</h2><p className="mt-1 text-[9.5px] text-neutral-500">تصاویر را بکشید و مرتب کنید؛ فایل اول یا تصویر انتخاب‌شده به‌عنوان اصلی استفاده می‌شود.</p></div><label className="h-9 cursor-pointer bg-[#011c3a] px-4 text-[10px] leading-9 text-white">آپلود تصویر<input aria-label="آپلود تصویر" type="file" accept="image/*" multiple className="sr-only" onChange={e=>readFiles(e.target.files).catch(error=>setMessage({type:"error",text:error.message}))}/></label></div><div className="mt-4 flex max-w-xl gap-2"><input aria-label="افزودن تصویر با آدرس" value={mediaUrl} onChange={e=>setMediaUrl(e.target.value)} placeholder="https://example.com/product.jpg" className={input}/><button onClick={()=>{if(!/^https?:\/\//.test(mediaUrl)){setMessage({type:"error",text:"آدرس تصویر معتبر نیست."});return;}update("images",[...draft.images,mediaUrl]);setMediaUrl("")}} className={secondary}>افزودن از URL</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">{draft.images.map((src,index)=><article key={`${src.slice(0,30)}-${index}`} draggable onDragStart={()=>setDragIndex(index)} onDragOver={e=>e.preventDefault()} onDrop={()=>{if(dragIndex===null||dragIndex===index)return;const next=[...draft.images];const [moved]=next.splice(dragIndex,1);next.splice(index,0,moved);update("images",next);setDragIndex(null)}} className={(draft.admin.mainImage===index?"border-[#011c3a]":"border-neutral-200")+" border bg-white p-2"}><img src={src} alt={`تصویر ${index+1}`} className="aspect-[3/4] w-full object-cover"/><div className="mt-2 flex items-center justify-between gap-1"><button onClick={()=>updateAdmin("mainImage",index)} className="text-[9px] underline">{draft.admin.mainImage===index?"تصویر اصلی":"انتخاب اصلی"}</button><button aria-label={`حذف تصویر ${index+1}`} onClick={()=>{update("images",draft.images.filter((_,i)=>i!==index));updateAdmin("mainImage",0)}} className="text-[9px] text-red-700 underline">حذف</button></div></article>)}</div>{!draft.images.length&&<Empty title="تصویری بارگذاری نشده است"/>}<div className="mt-7 border-t pt-5"><h2 className="text-[12px] font-medium">ویدئوی محصول</h2><div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label="آدرس ویدئو"><input aria-label="آدرس ویدئو" value={draft.video?.url??""} onChange={e=>update("video",{url:e.target.value,title:draft.video?.title??"",poster:draft.video?.poster??draft.images[0]??""})} className={input}/></Field><Field label="عنوان ویدئو"><input aria-label="عنوان ویدئو" value={draft.video?.title??""} onChange={e=>update("video",{url:draft.video?.url??"",title:e.target.value,poster:draft.video?.poster??draft.images[0]??""})} className={input}/></Field><Field label="پوستر ویدئو"><input aria-label="پوستر ویدئو" value={draft.video?.poster??""} onChange={e=>update("video",{url:draft.video?.url??"",title:draft.video?.title??"",poster:e.target.value})} className={input}/></Field></div></div></section>}
      {tab==="specs"&&<section><h2 className="text-[13px] font-medium">مشخصات فنی</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{specOrder.map(key=><Field key={key} label={specLabels[key]}><input aria-label={specLabels[key]} value={draft.specs[key]} onChange={e=>update("specs",{...draft.specs,[key]:e.target.value})} className={input}/></Field>)}</div><div className="mt-6 border-t pt-5"><div className="flex justify-between"><h3 className="text-[12px] font-medium">فیلدهای آزاد</h3><button onClick={()=>updateAdmin("customSpecs",[...draft.admin.customSpecs,{id:`spec-${Date.now()}`,label:"",value:""}])} className={secondary}>افزودن مشخصه</button></div><div className="mt-3 space-y-2">{draft.admin.customSpecs.map(item=><div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label={`عنوان مشخصه ${item.id}`} value={item.label} onChange={e=>updateAdmin("customSpecs",draft.admin.customSpecs.map(x=>x.id===item.id?{...x,label:e.target.value}:x))} placeholder="عنوان" className={input}/><input aria-label={`مقدار مشخصه ${item.id}`} value={item.value} onChange={e=>updateAdmin("customSpecs",draft.admin.customSpecs.map(x=>x.id===item.id?{...x,value:e.target.value}:x))} placeholder="مقدار" className={input}/><button onClick={()=>updateAdmin("customSpecs",draft.admin.customSpecs.filter(x=>x.id!==item.id))} className="px-3 text-[10px] text-red-700 underline">حذف</button></div>)}</div></div></section>}
      {tab==="size"&&<section><div className="flex justify-between"><div><h2 className="text-[13px] font-medium">جدول سایز اختصاصی</h2><p className="mt-1 text-[9.5px] text-neutral-500">اعداد بر حسب سانتی‌متر هستند.</p></div><button onClick={()=>update("sizeChart",[...draft.sizeChart,{size:"M",chest:"",shoulder:"",length:"",sleeve:""}])} className={secondary}>افزودن ردیف</button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[660px] text-right text-[10px]"><thead><tr>{["سایز","دور سینه","عرض شانه","قد","آستین",""] .map(x=><th key={x} className="border-b p-2 font-medium">{x}</th>)}</tr></thead><tbody>{draft.sizeChart.map((row,index)=><tr key={`${row.size}-${index}`} className="border-b">{(["size","chest","shoulder","length","sleeve"] as const).map(key=><td key={key} className="p-1"><input aria-label={`${key} ${index}`} value={row[key]} onChange={e=>update("sizeChart",draft.sizeChart.map((x,i)=>i===index?{...x,[key]:e.target.value}:x))} className="h-9 w-full border px-2"/></td>)}<td><button onClick={()=>update("sizeChart",draft.sizeChart.filter((_,i)=>i!==index))} className="text-red-700 underline">حذف</button></td></tr>)}</tbody></table></div><Field label="راهنمای انتخاب سایز" wide><textarea aria-label="راهنمای انتخاب سایز" rows={4} value={draft.sizeAdvice} onChange={e=>update("sizeAdvice",e.target.value)} className="mt-4 w-full border p-3 text-[11px]"/></Field></section>}
      {tab==="relations"&&(
        <RelationsSection
          draft={draft}
          onRelatedChange={(ids)=>update("relatedIds",ids)}
          onComplementaryChange={(ids)=>update("complementaryIds",ids)}
          onLookChange={(look)=>updateAdmin("look",look)}
        />
      )}
      {tab==="workflow"&&<section className="grid gap-5 xl:grid-cols-[320px_1fr]"><aside className="border border-neutral-200 p-4"><h2 className="text-[12px] font-medium">گردش انتشار</h2><div className="mt-4 space-y-2">{(["draft","review","published"] as ProductStatus[]).map(status=><button key={status} onClick={()=>updateAdmin("status",status)} className={(draft.admin.status===status?"border-[#011c3a] bg-[#f3f5f7]":"border-neutral-200")+" flex w-full items-center justify-between border p-3 text-[10.5px]"}><span>{statusLabel[status]}</span>{draft.admin.status===status&&<span>فعال</span>}</button>)}</div>{errors.length>0&&<div className="mt-4 border border-red-200 bg-red-50 p-3"><p className="text-[10px] font-medium text-red-700">موارد لازم</p><ul className="mt-2 space-y-1 text-[9.5px] text-red-700">{errors.map(x=><li key={x}>• {x}</li>)}</ul></div>}</aside><div><h2 className="text-[12px] font-medium">تاریخچه نسخه‌ها</h2><div className="mt-3 divide-y border-y border-neutral-200">{draft.admin.versions.map((version,index)=><article key={version.id} className="grid gap-2 py-3 text-[10px] sm:grid-cols-[100px_1fr_140px_auto]"><span className="font-medium">نسخه {faNumber(draft.admin.versions.length-index)}</span><span>{version.summary}</span><span className="text-neutral-400">{version.at}</span><button onClick={()=>setSelectedVersion(version.id)} className="underline">مقایسه</button></article>)}{!draft.admin.versions.length&&<Empty title="پس از اولین ذخیره، تاریخچه اینجا نمایش داده می‌شود"/>}</div>{selectedVersion&&<VersionInspector current={draft} versionId={selectedVersion} onClose={()=>setSelectedVersion(null)} onRestore={restoreVersion}/>}</div></section>}
    </main>
  </div>;
}

function Field({label,required,wide,children}:{label:string;required?:boolean;wide?:boolean;children:ReactNode}){return <label className={wide?"sm:col-span-2":""}><span className="mb-1.5 block text-[10px] text-neutral-500">{label}{required&&<b className="mr-1 text-red-700">*</b>}</span>{children}</label>}
function TokenEditor({label,value,onChange,items,onAdd,onRemove}:{label:string;value:string;onChange:(x:string)=>void;items:string[];onAdd:()=>void;onRemove:(x:string)=>void}){return <section className="border border-neutral-200 p-4"><h2 className="text-[11px] font-medium">{label}</h2><div className="mt-3 flex gap-2"><input aria-label={`افزودن ${label}`} value={value} onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onAdd()}}} className={input}/><button onClick={onAdd} className={secondary}>افزودن</button></div><div className="mt-3 flex flex-wrap gap-2">{items.map(item=><button key={item} onClick={()=>onRemove(item)} className="border border-neutral-300 px-2 py-1 text-[9px]">{item} ×</button>)}</div></section>}
function Empty({title,action}:{title:string;action?:ReactNode}){return <div className="py-12 text-center"><p className="text-[11px] text-neutral-400">{title}</p>{action&&<div className="mt-3">{action}</div>}</div>}
const faNumber=(value:number)=>new Intl.NumberFormat("fa-IR").format(value);

function VariantTemplate({onBuild}:{onBuild:(colour:string,hex:string,sizes:string[])=>void}){const [colour,setColour]=useState("سرمه‌ای");const [hex,setHex]=useState("#17253b");const [sizes,setSizes]=useState(["S","M","L","XL"]);return <div className="mt-5 border border-neutral-200 bg-[#f8f8f6] p-4"><div className="flex flex-wrap items-end gap-3"><Field label="نام رنگ"><input aria-label="نام رنگ قالب" value={colour} onChange={e=>setColour(e.target.value)} className={input}/></Field><Field label="کد رنگ"><input aria-label="کد رنگ قالب" type="color" value={hex} onChange={e=>setHex(e.target.value)} className="h-10 w-20 border border-neutral-300"/></Field><fieldset><legend className="mb-1.5 text-[10px] text-neutral-500">سایزها</legend><div className="flex flex-wrap gap-2">{["XS","S","M","L","XL","XXL","3XL"].map(size=><label key={size} className="flex h-10 items-center gap-1 border border-neutral-300 bg-white px-2 text-[9.5px]"><input type="checkbox" checked={sizes.includes(size)} onChange={()=>setSizes(current=>current.includes(size)?current.filter(x=>x!==size):[...current,size])}/>{size}</label>)}</div></fieldset><button disabled={!colour.trim()||!sizes.length} onClick={()=>onBuild(colour,hex,sizes)} className="h-10 bg-[#011c3a] px-4 text-[10px] text-white disabled:bg-neutral-300">ساخت ماتریس رنگ و سایز</button></div></div>}

function VersionInspector({current,versionId,onClose,onRestore}:{current:AdminProductRecord;versionId:string;onClose:()=>void;onRestore:(id:string)=>void}){const version=current.admin.versions.find(v=>v.id===versionId);let old:AdminProductRecord|null=null;try{old=version?.snapshot?JSON.parse(version.snapshot) as AdminProductRecord:null}catch{old=null}const changes=old?[["نام",old.name,current.name],["قیمت",String(old.price),String(current.price)],["وضعیت",statusLabel[old.admin.status],statusLabel[current.admin.status]],["تصاویر",String(old.images.length),String(current.images.length)],["تنوع‌ها",String(old.admin.variants.length),String(current.admin.variants.length)],["توضیحات",old.description,current.description]].filter(([,a,b])=>a!==b):[];return <aside className="mt-4 border border-[#011c3a] p-4" aria-label="مقایسه نسخه"><div className="flex justify-between"><div><p className="text-[9px] text-neutral-400">VERSION COMPARISON</p><h3 className="mt-1 text-[11.5px] font-medium">مقایسه با {version?.at}</h3></div><button onClick={onClose} className="text-[10px] underline">بستن</button></div>{old?<div className="mt-4">{changes.length?changes.map(([label,before,after])=><div key={label} className="grid gap-2 border-t py-3 text-[9.5px] sm:grid-cols-[90px_1fr_1fr]"><strong>{label}</strong><span className="text-red-700 line-through">{before}</span><span className="text-[#36563a]">{after}</span></div>):<p className="py-5 text-center text-[10px] text-neutral-400">تفاوتی با وضعیت فعلی پیدا نشد.</p>}<button onClick={()=>onRestore(versionId)} className="mt-3 h-9 border border-[#011c3a] px-4 text-[10px]">بازیابی این نسخه</button></div>:<p className="mt-4 text-[10px] text-neutral-500">داده مقایسه برای این نسخه قدیمی موجود نیست.</p>}</aside>}

/* ═══════════════ تب تنوع و موجودی — گروهی بر اساس رنگ (آکاردئونی) ═══════════════ */

function VariantsSection({
  draft, warehouses, onPatchVariant, onSetVariants, onAddVariant, onBuildTemplate, onApplyBasePrice,
}: {
  draft: AdminProductRecord;
  warehouses: string[];
  onPatchVariant: (id: string, patch: Partial<AdminVariant>) => void;
  onSetVariants: (variants: AdminVariant[]) => void;
  onAddVariant: () => void;
  onBuildTemplate: (colour: string, hex: string, sizes: string[]) => void;
  onApplyBasePrice: () => void;
}) {
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [newSize, setNewSize] = useState("M");

  /* گروهبندی تنوعها بر اساس رنگ */
  const groups = useMemo(() => {
    const map = new Map<string, { colour: string; hex: string; variants: AdminVariant[] }>();
    for (const v of draft.admin.variants) {
      const key = v.colour.trim() || "بدون رنگ";
      const group = map.get(key);
      if (group) group.variants.push(v);
      else map.set(key, { colour: v.colour, hex: v.hex, variants: [v] });
    }
    return [...map.values()];
  }, [draft.admin.variants]);

  const expanded = (colour: string) => openGroups.includes(colour);
  const toggleGroup = (colour: string) => setOpenGroups((current) => current.includes(colour) ? current.filter((x) => x !== colour) : [...current, colour]);

  /* جمع موجودی هر انبار */
  const warehouseTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of draft.admin.variants) map.set(v.warehouse, (map.get(v.warehouse) ?? 0) + (Number(v.stock) || 0));
    return [...map.entries()];
  }, [draft.admin.variants]);

  const totalStock = draft.admin.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  const outOfStock = draft.admin.variants.filter((v) => !Number(v.stock)).length;

  const addSizeToColour = (colour: string, hex: string) => {
    const exists = draft.admin.variants.some((v) => v.colour === colour && v.size === newSize);
    if (exists) return;
    onSetVariants([...draft.admin.variants, {
      id: `variant-${Date.now()}`,
      colour, hex, size: newSize,
      sku: `${draft.specs.code || "SKU"}-${colour.slice(0, 2)}-${newSize}`.replace(/\s/g, ""),
      barcode: `626${String(Date.now()).slice(-10)}`,
      price: draft.price, stock: 0, warehouse: warehouses[0],
    }]);
  };

  const cell = "h-9 w-full border border-neutral-300 bg-white px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium">تنوع و موجودی — گروهی بر اساس رنگ</h2>
          <p className="mt-1 text-[9.5px] leading-relaxed text-neutral-500">هر رنگ یک ردیف است؛ با بازکردن آن، سایزها و موجودی هر سایز دیده می‌شود. موجودی هر سایز مستقیماً با انبار سینک است.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onApplyBasePrice} className={secondary}>اعمال قیمت پایه به همه</button>
          <button onClick={onAddVariant} className="h-9 bg-[#011c3a] px-4 text-[10px] text-white">افزودن ردیف جدید</button>
        </div>
      </div>

      {/* ساخت سریع ماتریس رنگ × سایز */}
      <VariantTemplate onBuild={onBuildTemplate} />

      {/* خلاصه انبار */}
      {draft.admin.variants.length > 0 && (
        <div className="mt-5 grid gap-2 border border-neutral-200 bg-[#f8f8f6] p-3 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          <div className="rounded-[4px] border border-neutral-200 bg-white p-3 text-center">
            <p className="text-[9px] text-neutral-500">کل موجودی</p>
            <p className="mt-1 text-[16px] font-medium text-[#011c3a]">{totalStock.toLocaleString("fa-IR")}</p>
          </div>
          {warehouseTotals.map(([warehouse, total]) => (
            <div key={warehouse} className="rounded-[4px] border border-neutral-200 bg-white p-3 text-center">
              <p className="text-[9px] text-neutral-500">{warehouse}</p>
              <p className="mt-1 text-[14px] font-medium">{total.toLocaleString("fa-IR")}</p>
            </div>
          ))}
          <div className="rounded-[4px] border border-neutral-200 bg-white p-3 text-center">
            <p className="text-[9px] text-neutral-500">سایزهای ناموجود</p>
            <p className={"mt-1 text-[14px] font-medium " + (outOfStock ? "text-red-700" : "text-[#36563a]")}>{outOfStock.toLocaleString("fa-IR")}</p>
          </div>
        </div>
      )}

      {/* گروههای رنگ */}
      <div className="mt-5 space-y-3">
        {groups.map((group) => {
          const groupStock = group.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
          const isOpen = expanded(group.colour);
          return (
            <div key={group.colour} className="border border-neutral-200">
              {/* سرگروه رنگ — یک ردیف برای هر رنگ */}
              <button
                type="button"
                onClick={() => toggleGroup(group.colour)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-3 bg-neutral-50 px-3 py-2.5 text-right transition hover:bg-neutral-100"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-[9px]">
                  <Icon name={isOpen ? "minus" : "plus"} className="h-3 w-3" />
                </span>
                <span className="h-7 w-7 shrink-0 rounded-full border border-black/10" style={{ background: group.hex }} />
                <span className="text-[11.5px] font-medium">{group.colour}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[9px] text-neutral-500">{group.variants.length.toLocaleString("fa-IR")} سایز</span>
                <span className={"rounded-full px-2 py-0.5 text-[9px] " + (groupStock > 0 ? "bg-[#edf3ee] text-[#36563a]" : "bg-red-50 text-red-700")}>
                  موجودی: {groupStock.toLocaleString("fa-IR")}
                </span>
                <span className="mr-auto flex items-center gap-1.5 text-[9px] text-neutral-400">
                  {[...new Set(group.variants.map((v) => v.warehouse))].map((w) => <span key={w} className="rounded-full border border-neutral-200 bg-white px-2 py-0.5">{w}</span>)}
                </span>
              </button>

              {/* سایزهای این رنگ — بازشو */}
              {isOpen && (
                <div className="overflow-x-auto border-t border-neutral-200">
                  <table className="w-full min-w-[880px] text-right text-[9.5px]">
                    <thead className="bg-white">
                      <tr>{["سایز", "SKU", "بارکد", "قیمت (تومان)", "موجودی", "انبار", ""].map((x) => <th key={x} className="border-b border-neutral-100 p-2 font-medium text-neutral-500">{x}</th>)}</tr>
                    </thead>
                    <tbody>
                      {group.variants.map((v) => (
                        <tr key={v.id} className="border-b border-neutral-50">
                          <td className="p-1.5 font-medium">{v.size}</td>
                          <td className="p-1"><input aria-label={`sku ${v.id}`} dir="ltr" value={v.sku} onChange={(e) => onPatchVariant(v.id, { sku: e.target.value })} className={cell} /></td>
                          <td className="p-1"><input aria-label={`barcode ${v.id}`} dir="ltr" value={v.barcode} onChange={(e) => onPatchVariant(v.id, { barcode: e.target.value })} className={cell} /></td>
                          <td className="p-1"><input aria-label={`price ${v.id}`} type="number" min="0" value={v.price} onChange={(e) => onPatchVariant(v.id, { price: Number(e.target.value) })} className={cell + " w-28"} /></td>
                          <td className="p-1">
                            <input aria-label={`stock ${v.id}`} type="number" min="0" value={v.stock} onChange={(e) => onPatchVariant(v.id, { stock: Number(e.target.value) })} className={cell + " w-20 " + (!Number(v.stock) ? "border-red-200 bg-red-50" : "border-[#b9cfbc] bg-[#f4f8f4]")} />
                          </td>
                          <td className="p-1">
                            <select aria-label={`warehouse ${v.id}`} value={v.warehouse} onChange={(e) => onPatchVariant(v.id, { warehouse: e.target.value })} className={cell}>
                              {warehouses.map((x) => <option key={x}>{x}</option>)}
                            </select>
                          </td>
                          <td className="p-1"><button aria-label={`حذف ${v.sku}`} onClick={() => onSetVariants(draft.admin.variants.filter((x) => x.id !== v.id))} className="px-2 text-red-700 underline">حذف</button></td>
                        </tr>
                      ))}
                      {/* افزودن سایز به این رنگ */}
                      <tr className="bg-neutral-50">
                        <td colSpan={7} className="p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[9.5px] text-neutral-500">افزودن سایز به «{group.colour}»:</span>
                            <select value={newSize} onChange={(e) => setNewSize(e.target.value)} className={cell + " w-20"}>
                              {["XS", "S", "M", "L", "XL", "XXL", "3XL"].map((s) => <option key={s}>{s}</option>)}
                            </select>
                            <button onClick={() => addSizeToColour(group.colour, group.hex)} className="h-9 bg-[#011c3a] px-3 text-[9.5px] text-white">افزودن</button>
                            <button onClick={() => onSetVariants(draft.admin.variants.filter((x) => x.colour !== group.colour))} className="mr-auto h-9 border border-red-200 px-3 text-[9.5px] text-red-700">حذف کل رنگ «{group.colour}»</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {!draft.admin.variants.length && <Empty title="هنوز تنوعی ساخته نشده" action={<button onClick={onAddVariant} className={secondary}>ساخت اولین تنوع</button>} />}
      </div>

      <button onClick={() => onSetVariants(draft.admin.variants)} className="mt-4 h-9 border border-[#011c3a] px-4 text-[10px]">به‌روزرسانی رنگ‌ها و سایزهای فروشگاه از روی موجودی</button>
    </section>
  );
}

/* ═══════════════ تب محصولات مرتبط + مکمل + هاتاسپات ═══════════════ */

function RelationsSection({
  draft, onRelatedChange, onComplementaryChange, onLookChange,
}: {
  draft: AdminProductRecord;
  onRelatedChange: (ids: string[]) => void;
  onComplementaryChange: (ids: string[]) => void;
  onLookChange: (look: AdminProductRecord["admin"]["look"]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedHotspot, setSelectedHotspot] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busyImage, setBusyImage] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const look = draft.admin.look ?? { image: "", hotspots: [] };
  const lookImage = look.image || draft.images[draft.admin.mainImage] || draft.images[0] || "";
  const complementary = products.filter((p) => p.id !== draft.id);
  const chosenComplementary = complementary.filter((p) => draft.complementaryIds.includes(p.id));
  const filtered = complementary.filter((p) => !search.trim() || (p.name + p.latin).includes(search.trim()));

  const setHotspots = (hotspots: AdminLookHotspot[]) => onLookChange({ ...look, hotspots });

  /* افزودن هاتاسپات با کلیک روی تصویر — به محصول مکمل اول یا بدون لینک */
  const addHotspotAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragId) return;
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.round(Math.max(0, Math.min(100, ((box.right - e.clientX) / box.width) * 100)));
    const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - box.top) / box.height) * 100)));
    const linked = chosenComplementary[0];
    const hotspot: AdminLookHotspot = {
      id: `h-${Date.now()}`,
      x, y,
      label: linked ? linked.name : "قطعه جدید",
      color: "#c9654d",
      visible: true,
      productId: linked ? linked.id : "",
    };
    setHotspots([...look.hotspots, hotspot]);
    setSelectedHotspot(hotspot.id);
  };

  const moveHotspot = (id: string, clientX: number, clientY: number) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.max(0, Math.min(100, Math.round(((box.right - clientX) / box.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((clientY - box.top) / box.height) * 100)));
    setHotspots(look.hotspots.map((h) => (h.id === id ? { ...h, x, y } : h)));
  };

  const patchHotspot = (id: string, patch: Partial<AdminLookHotspot>) =>
    setHotspots(look.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const linkProduct = (hotspotId: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    patchHotspot(hotspotId, { productId, label: product ? product.name : "بدون لینک" });
    if (productId && !draft.complementaryIds.includes(productId)) {
      onComplementaryChange([...draft.complementaryIds, productId]);
    }
  };

  const selected = look.hotspots.find((h) => h.id === selectedHotspot) ?? null;

  return (
    <section className="space-y-6">
      {/* انتخابگرهای محصول */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* مرتبط */}
        <div>
          <h2 className="text-[12px] font-medium">محصولات مرتبط</h2>
          <p className="mt-1 text-[9.5px] text-neutral-500">در انتهای صفحه جزئیات محصول نمایش داده می‌شوند.</p>
          <div className="mt-3 max-h-80 overflow-y-auto border border-neutral-200">
            {complementary.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b p-2.5 text-[10.5px] transition hover:bg-neutral-50">
                <input type="checkbox" checked={draft.relatedIds.includes(item.id)} onChange={() => onRelatedChange(draft.relatedIds.includes(item.id) ? draft.relatedIds.filter((x) => x !== item.id) : [...draft.relatedIds, item.id])} className="accent-[#011c3a]" />
                <img src={item.images[0]} alt="" className="h-10 w-8 shrink-0 rounded-[3px] object-cover" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="shrink-0 text-[9px] text-neutral-400">{item.specs.code}</span>
              </label>
            ))}
          </div>
        </div>

        {/* مکمل */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[12px] font-medium">محصولات مکمل</h2>
              <p className="mt-1 text-[9.5px] text-neutral-500">این قطعات ستِ پیشنهادی محصول را می‌سازند و کنار عکس هات‌اسپات می‌آیند.</p>
            </div>
            <span className="shrink-0 rounded-full bg-[#f6f6f4] px-2.5 py-1 text-[9.5px]">{draft.complementaryIds.length.toLocaleString("fa-IR")} انتخاب</span>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی محصول مکمل…" className={input + " mt-3"} />
          <div className="mt-2 max-h-64 overflow-y-auto border border-neutral-200">
            {filtered.map((item) => {
              const checked = draft.complementaryIds.includes(item.id);
              return (
                <label key={item.id} className={(checked ? "bg-[#f3f5f7]" : "") + " flex cursor-pointer items-center gap-3 border-b p-2.5 text-[10.5px] transition hover:bg-neutral-50"}>
                  <input type="checkbox" checked={checked} onChange={() => onComplementaryChange(checked ? draft.complementaryIds.filter((x) => x !== item.id) : [...draft.complementaryIds, item.id])} className="accent-[#011c3a]" />
                  <img src={item.images[0]} alt="" className="h-10 w-8 shrink-0 rounded-[3px] object-cover" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-[9px] text-neutral-500">{(item.price / 1_000_000).toFixed(1)}م</span>
                </label>
              );
            })}
            {!filtered.length && <p className="p-4 text-center text-[10px] text-neutral-400">موردی پیدا نشد.</p>}
          </div>
        </div>
      </div>

      {/* هاتاسپات — عکس محصول + نقاط لینکشده به مکملها */}
      <div className="rounded-[6px] border border-neutral-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[12px] font-medium">با این ست کنید — هات‌اسپات روی عکس محصول</h2>
            <p className="mt-1 text-[9.5px] leading-relaxed text-neutral-500">
              روی عکس کلیک کن تا هات‌اسپات اضافه شود، بعد محصول مکمل را به آن وصل کن. عکس پیش‌فرض، محصولِ روی تن مدل است — همان چیزی که مشتری در صفحه محصول می‌بیند.
            </p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setBusyImage(true); try { onLookChange({ ...look, image: await fileToOptimizedDataUrl(file, 1400, 0.85) }); } finally { setBusyImage(false); } }} />
            <button onClick={() => fileRef.current?.click()} className={secondary}>{busyImage ? "…" : "عکس اختصاصی"}</button>
            {look.image && <button onClick={() => onLookChange({ ...look, image: "" })} className={secondary}>بازگشت به عکس خود محصول</button>}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* بوم */}
          <div>
            <div
              ref={canvasRef}
              onClick={addHotspotAt}
              onMouseMove={(e) => { if (dragId) moveHotspot(dragId, e.clientX, e.clientY); }}
              onMouseUp={() => setDragId(null)}
              onMouseLeave={() => setDragId(null)}
              className="relative select-none overflow-hidden rounded-[6px] border-2 border-dashed border-neutral-300 bg-neutral-100"
            >
              {lookImage ? (
                <img src={lookImage} alt="" draggable={false} className="aspect-[3/4] w-full cursor-crosshair object-cover" />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center text-center text-[11px] text-neutral-400">اول از تب «رسانه» عکس محصول را اضافه کن</div>
              )}
              {look.hotspots.map((h) => {
                const linked = products.find((p) => p.id === h.productId);
                return (
                  <button
                    key={h.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragId(h.id); setSelectedHotspot(h.id); }}
                    onClick={(e) => { e.stopPropagation(); setSelectedHotspot(h.id); }}
                    className={"absolute z-10 cursor-grab touch-none transition active:cursor-grabbing " + (selectedHotspot === h.id ? "scale-125" : "")}
                    style={{ right: `${h.x}%`, top: `${h.y}%`, opacity: h.visible ? 1 : 0.35 }}
                    title={`${h.label} — بکش و جابه‌جا کن`}
                  >
                    <span className="block h-5 w-5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white shadow-lg" style={{ background: h.color }}>
                      {selectedHotspot === h.id && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-white/80" />}
                    </span>
                    <span className="pointer-events-none absolute right-1/2 top-4 translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-medium text-white shadow" style={{ background: h.color }}>
                      {linked ? linked.name : h.label}{linked ? ` · ${(linked.price / 1_000_000).toFixed(1)}م` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-neutral-400">کلیک روی عکس = هات‌اسپات جدید · درگ = جابه‌جایی</p>
          </div>

          {/* پنل هاتاسپاتها */}
          <div className="space-y-3">
            <div className="rounded-[6px] border border-neutral-200 p-3">
              <p className="text-[11px] font-medium text-neutral-500">هات‌اسپات‌ها ({look.hotspots.length.toLocaleString("fa-IR")})</p>
              <div className="mt-2 space-y-1">
                {look.hotspots.map((h) => (
                  <button key={h.id} onClick={() => setSelectedHotspot(h.id)} className={(selectedHotspot === h.id ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-200 hover:border-[#011c3a]") + " flex w-full items-center gap-2 rounded-[4px] border px-2.5 py-1.5 text-right text-[11px] transition"}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
                    <span className="min-w-0 flex-1 truncate">{h.label}</span>
                    <span className={"shrink-0 text-[9px] " + (selectedHotspot === h.id ? "text-white/60" : "text-neutral-400")}>{h.visible ? (h.productId ? "لینک‌شده" : "بدون لینک") : "مخفی"}</span>
                  </button>
                ))}
                {!look.hotspots.length && <p className="py-3 text-center text-[10px] text-neutral-400">روی عکس کلیک کن تا اولین هات‌اسپات ساخته شود.</p>}
              </div>
            </div>

            {selected && (
              <div className="space-y-2.5 rounded-[6px] border border-neutral-200 p-3">
                <p className="text-[11px] font-medium text-neutral-500">ویرایش «{selected.label}»</p>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-neutral-500">محصول مکمل متصل</span>
                  <select value={selected.productId} onChange={(e) => linkProduct(selected.id, e.target.value)} className={input}>
                    <option value="">— بدون لینک —</option>
                    {chosenComplementary.map((p) => <option key={p.id} value={p.id}>{p.name} · {(p.price / 1_000_000).toFixed(1)}م</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-neutral-500">برچسب روی نقطه</span>
                  <input value={selected.label} onChange={(e) => patchHotspot(selected.id, { label: e.target.value })} className={input} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-neutral-500">رنگ نقطه</span>
                    <input type="color" value={selected.color} onChange={(e) => patchHotspot(selected.id, { color: e.target.value })} className="h-10 w-full cursor-pointer border border-neutral-300" />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-[10.5px]">
                    <input type="checkbox" checked={selected.visible} onChange={(e) => patchHotspot(selected.id, { visible: e.target.checked })} className="accent-[#011c3a]" />
                    نمایش
                  </label>
                </div>
                <button onClick={() => { setHotspots(look.hotspots.filter((h) => h.id !== selected.id)); setSelectedHotspot(null); }} className="h-9 w-full border border-red-200 text-[10px] text-red-700">حذف این هات‌اسپات</button>
                <p className="text-[9.5px] leading-relaxed text-neutral-400">نکته: محصول متصل باید در لیست «محصولات مکمل» باشد؛ با انتخاب از همین لیست خودکار اضافه می‌شود.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
