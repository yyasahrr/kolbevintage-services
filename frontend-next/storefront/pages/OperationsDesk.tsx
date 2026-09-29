import { useEffect, useState } from "react";
import { api, loadToken } from "../lib/api";

const field = "mt-1 h-10 w-full border border-neutral-300 bg-white px-3 text-[11px]";
const button = "h-10 bg-[#011c3a] px-4 text-[10.5px] text-white disabled:opacity-40";

function admin() {
  return loadToken("admin");
}

export function OperationsCenter({ initial = "shipping" }: { initial?: "shipping" | "automation" | "tracking" | "people" | "reviews" | "recommendations" }) {
  const [tab, setTab] = useState(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shipping, setShipping] = useState<any>(null);
  const [automation, setAutomation] = useState<any>(null);
  const [shipments, setShipments] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [person, setPerson] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [recs, setRecs] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [rule, setRule] = useState({ methodId: "pishtaz", ruleType: "weight_based", bands: "0-500:80000,500-1000:110000,1000-2000:160000,2000-5000:250000" });

  const load = async () => {
    setError("");
    try {
      if (tab === "shipping") setShipping(await api("/store/kolbe/admin/shipping/rules", { token: admin() }));
      if (tab === "automation") setAutomation(await api("/store/kolbe/admin/automation", { token: admin() }));
      if (tab === "tracking") {
        setShipments((await api<any>("/store/kolbe/admin/shipments", { token: admin() })).shipments ?? []);
        setImports((await api<any>("/store/kolbe/admin/tracking/imports", { token: admin() })).imports ?? []);
      }
      if (tab === "people") {
        setPeople((await api<any>("/store/kolbe/admin/people", { token: admin() })).people ?? []);
        setSegments((await api<any>("/store/kolbe/admin/segments", { token: admin() })).segments ?? []);
      }
      if (tab === "reviews") setReviews((await api<any>("/store/kolbe/admin/reviews", { token: admin() })).reviews ?? []);
      if (tab === "recommendations") setRecs(await api("/store/kolbe/admin/recommendations", { token: admin() }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "خوانده نشد");
    }
  };
  useEffect(() => { void load(); }, [tab]);

  const tabs = [
    ["shipping", "حمل"],
    ["automation", "اتوماسیون"],
    ["tracking", "مرسوله"],
    ["people", "مشتری ۳۶۰"],
    ["reviews", "نظرات"],
    ["recommendations", "پیشنهاد"],
  ] as const;

  return (
    <section>
      <header className="mb-4">
        <p className="text-[9px] tracking-[0.18em] text-neutral-400">OPERATIONS</p>
        <h1 className="mt-1 text-[18px] font-medium">مرکز عملیات</h1>
        <p className="mt-1 max-w-3xl text-[10.5px] leading-6 text-neutral-500">هزینه ارسال، صف رویداد، رهگیری، پرونده مشتری، نظر و پیشنهاد از سرور می‌آید. رمز اتصال در این صفحه نیست.</p>
      </header>
      {error && <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-3 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">{notice}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={"h-9 px-3 text-[11px] " + (tab === id ? "bg-[#011c3a] text-white" : "border")}>{label}</button>
        ))}
      </div>

      {tab === "shipping" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="border bg-white p-4" onSubmit={async (event) => {
            event.preventDefault();
            const bands = rule.bands.split(",").map((part) => {
              const [range, amount] = part.split(":");
              const [min, max] = range.split("-").map(Number);
              return { minGrams: min, maxGrams: max, amount: Number(amount) };
            });
            await api("/store/kolbe/admin/shipping/rules", { method: "POST", token: admin(), body: { methodId: rule.methodId, ruleType: rule.ruleType, priority: 40, config: { bands } } });
            setNotice("قانون حمل ذخیره شد. مبلغ را سرور حساب می‌کند.");
            await load();
          }}>
            <label className="block text-[10px]">روش<select className={field} value={rule.methodId} onChange={(e) => setRule({ ...rule, methodId: e.target.value })}>{(shipping?.methods ?? []).map((item: any) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="mt-2 block text-[10px]">نوع<select className={field} value={rule.ruleType} onChange={(e) => setRule({ ...rule, ruleType: e.target.value })}><option value="weight_based">وزنی</option><option value="flat_rate">ثابت</option><option value="destination">مقصد</option><option value="order_value">مبلغ سفارش</option><option value="composite">ترکیبی</option><option value="free_shipping">رایگان</option></select></label>
            <label className="mt-2 block text-[10px]">بازه وزن و مبلغ<input className={field} value={rule.bands} onChange={(e) => setRule({ ...rule, bands: e.target.value })} /></label>
            <button className={button + " mt-3"}>ذخیره قانون</button>
            <p className="mt-3 text-[10px] text-neutral-500">اگر وزن کالا ثبت نشده باشد و روش فقط وزنی باشد، سرور قیمت نمی‌سازد و سفارش را رد می‌کند.</p>
            <label className="mt-3 block text-[10px]">وزن محصول<input name="grams" className={field} placeholder="شناسه کالا و گرم، مثل belt-leather:720" onBlur={async (event) => {
              const [productId, grams] = event.target.value.split(":");
              if (!productId || !grams) return;
              await api("/store/kolbe/admin/shipping/weights", { method: "POST", token: admin(), body: { productId, grams: Number(grams) } });
              setNotice("وزن واقعی ذخیره شد.");
            }} /></label>
          </form>
          <div className="border bg-white p-4 text-[11px]">
            {(shipping?.rules ?? []).map((item: any) => <p key={item.id} className="border-b py-2">{item.method_id} · {item.rule_type} · اولویت {item.priority}</p>)}
          </div>
        </div>
      )}

      {tab === "automation" && (
        <div className="border bg-white p-4 text-[11px]">
          <p>وضعیت اتصال: {automation?.connection?.connected ? "وصل" : "بدون وب‌هوک فعال"}</p>
          <p className="mt-1 text-neutral-500">{automation?.warning}</p>
          <button className={button + " mt-3"} onClick={async () => { await api("/store/kolbe/admin/automation/drain", { method: "POST", token: admin(), body: {} }); setNotice("صف دوباره پردازش شد."); await load(); }}>تلاش دوباره صف</button>
          <div className="mt-4 space-y-2">
            {(automation?.runs ?? []).map((run: any) => (
              <div key={run.id} className="flex items-center justify-between border-b py-2">
                <span>{run.event_type} · {run.status} · تلاش {run.attempts}</span>
                {run.status === "failed" && <button className="underline" onClick={async () => { await api(`/store/kolbe/admin/automation/${run.id}/retry`, { method: "POST", token: admin(), body: {} }); await load(); }}>تلاش دوباره</button>}
              </div>
            ))}
          </div>
          {automation?.runs?.some((run: any) => run.last_error) && <p className="mt-3 text-red-700">آخرین خطا: {automation.runs.find((run: any) => run.last_error)?.last_error}</p>}
        </div>
      )}

      {tab === "tracking" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border bg-white p-4 text-[11px]">
            <h2 className="mb-2 font-medium">مرسوله‌ها</h2>
            {shipments.map((item) => (
              <button key={item.id} className="block w-full border-b py-2 text-right" onClick={async () => setTimeline((await api<any>(`/store/kolbe/admin/shipments/${item.id}/events`, { token: admin() })).events ?? [])}>
                {item.order_code} · {item.customer_name || "—"} · {item.phone || "—"} · {item.carrier || "حامل نامشخص"} · {item.origin || "—"} به {item.destination || "—"} · {item.tracking_code || "بدون کد"} · {item.status}
              </button>
            ))}
            {timeline.map((event) => <p key={event.id} className="mt-2 text-neutral-500">{event.status} · {event.location || "بدون مکان"} · {event.source}</p>)}
          </div>
          <div className="border bg-white p-4 text-[11px]">
            <h2 className="mb-2 font-medium">ورودی‌های نیازمند بررسی</h2>
            {imports.filter((item) => item.status === "review").map((item) => (
              <div key={item.id} className="border-b py-2">
                <p>{item.order_code} · اطمینان {item.confidence}</p>
                <button className="mt-1 underline" onClick={async () => { await api(`/store/kolbe/admin/tracking/imports/${item.id}/review`, { method: "POST", token: admin(), body: { decision: "confirm" } }); setNotice("پس از بررسی انسان اعمال شد."); await load(); }}>تأیید</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "people" && (
        <>
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="border bg-white p-3 text-[11px]">
            {people.map((item) => <button key={item.id} className="block w-full border-b py-2 text-right" onClick={async () => setPerson(await api(`/store/kolbe/admin/people/${item.id}`, { token: admin() }))}>{item.display_name || item.email}</button>)}
          </div>
          {person && (
            <div className="border bg-white p-4 text-[11px] leading-6">
              <p>{person.profile.display_name} {person.profile.family_name}</p>
              <p>برچسب‌ها: {(person.labels ?? []).map((label: any) => label.code).join("، ") || "هنوز از داده واقعی ساخته نشده"}</p>
              <p>خرید {person.behavior?.orderCount} · میانگین {person.behavior?.averageOrder} · لغو {person.behavior?.cancelled} · برگشت {person.behavior?.returns} · کوپن {person.behavior?.coupons}</p>
              <p>پلن: {person.profile.plan || "—"} · VIP: {person.profile.vip ? "بله" : "خیر"}</p>
              <p className="text-neutral-500">یادداشت‌ها فقط داخلی‌اند و به مشتری نشان داده نمی‌شوند.</p>
              <form className="mt-3" onSubmit={async (event) => {
                event.preventDefault();
                const body = new FormData(event.currentTarget).get("note");
                await api(`/store/kolbe/admin/people/${person.profile.id}/notes`, { method: "POST", token: admin(), body: { body } });
                setNotice("یادداشت داخلی ثبت شد.");
              }}>
                <input name="note" className={field} placeholder="یادداشت داخلی" />
                <button className={button + " mt-2"}>ثبت یادداشت</button>
              </form>
            </div>
          )}
        </div>
        <form className="mt-4 border bg-white p-4 text-[11px]" onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          await api("/store/kolbe/admin/segments", { method: "POST", token: admin(), body: { name: data.get("name"), definition: { all: [{ field: "city", op: "=", value: data.get("city") }, { field: "orderCount", op: ">", value: Number(data.get("orders") || 0) }] } } });
          setNotice("سگمنت پویا ذخیره شد و با هر بار خواندن دوباره حساب می‌شود.");
          await load();
        }}>
          <p className="mb-2 font-medium">سگمنت پویا</p>
          <input name="name" className={field} placeholder="نام سگمنت" required />
          <input name="city" className={field} placeholder="شهر" />
          <input name="orders" className={field} placeholder="حداقل تعداد خرید" />
          <button className={button + " mt-2"}>ساخت سگمنت</button>
          {segments.map((segment) => <p key={segment.id} className="mt-2">{segment.name}: {segment.members?.length ?? 0} عضو</p>)}
        </form>
        </>
      )}

      {tab === "reviews" && (
        <div className="border bg-white p-4 text-[11px]">
          {reviews.map((review) => (
            <div key={review.id} className="flex items-center justify-between border-b py-2">
              <span>{review.rating} ستاره · {review.status} · {review.verified_purchase ? "خرید تأییدشده" : "بدون خرید تأییدشده"}</span>
              <span className="flex gap-2">
                <button className="underline" onClick={async () => { await api(`/store/kolbe/admin/reviews/${review.id}/moderate`, { method: "POST", token: admin(), body: { status: "approved" } }); await load(); }}>تأیید</button>
                <button className="underline" onClick={async () => { await api(`/store/kolbe/admin/reviews/${review.id}/moderate`, { method: "POST", token: admin(), body: { status: "hidden" } }); await load(); }}>مخفی</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "recommendations" && (
        <div className="border bg-white p-4 text-[11px]">
          {(recs?.analytics ?? []).map((row: any) => <p key={row.slot + row.strategy} className="border-b py-2">{row.slot} · نمایش {row.impressions} · کلیک {row.clicks} · CTR {row.ctr == null ? "—" : Math.round(row.ctr * 100)}٪ · خرید {row.purchased} · درآمد {row.revenue}</p>)}
          {(recs?.slots ?? []).map((slot: any) => <p key={slot.code} className="border-b py-2 text-neutral-500">{slot.code} · {slot.strategy}</p>)}
          <p className="mt-3 text-neutral-500">قیمت از موتور قیمت است. آب‌وهوا تا وقتی اتصال واقعی نداشته باشد در پیشنهاد استفاده نمی‌شود.</p>
        </div>
      )}
    </section>
  );
}
