/**
 * نوار انتشار و تاریخچهٔ استودیوی طراحی (پاسخ ۵۰).
 *
 * چرا این کامپوننت جدا شد؟ چون «ذخیره» و «انتشار» دو کار متفاوت‌اند:
 * ذخیره فقط پیش‌نویس می‌سازد، انتشار آن را روی فروشگاه زنده می‌نشاند و نسخهٔ
 * پیشین را آرشیو می‌کند. کاربر باید در یک نگاه ببیند کدام نسخه زنده است، چه
 * چیزی منتشر نشده مانده و می‌تواند به هر نسخهٔ قبلی برگردد.
 */
import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import type { SiteSettings } from "../siteSettings";
import { useSiteDesignSaveState } from "../siteSettings";
import {
  loadSiteDesignState,
  publishSiteDesign,
  restoreSiteDesignRevision,
  siteDesignErrorMessage,
  type SiteDesignRevision,
  type SiteDesignState,
} from "../lib/siteDesignApi";

const numberFa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

function whenFa(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
  return parts;
}

const statusLabel: Record<SiteDesignRevision["status"], string> = {
  draft: "پیش‌نویس",
  published: "منتشرشده",
  archived: "آرشیو",
};

export default function DesignPublishPanel({ settings }: { settings: SiteSettings }) {
  const saveState = useSiteDesignSaveState();
  const [state, setState] = useState<SiteDesignState | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"load" | "publish" | "restore" | null>("load");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setBusy("load");
    try {
      setState(await loadSiteDesignState());
      setMessage(null);
    } catch (error) {
      setMessage({ kind: "error", text: siteDesignErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }, []);

  // پس از هر ذخیرهٔ موفق، تاریخچه را تازه می‌کنیم تا پیش‌نویس تازه دیده شود.
  useEffect(() => { void refresh(); }, [refresh, saveState.savedAt]);

  const publish = async () => {
    setBusy("publish");
    try {
      setState(await publishSiteDesign(null));
      setMessage({ kind: "ok", text: "نسخهٔ پیش‌نویس منتشر شد و روی فروشگاه زنده نشست." });
    } catch (error) {
      setMessage({ kind: "error", text: siteDesignErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (revisionId: string) => {
    setBusy("restore");
    try {
      setState(await restoreSiteDesignRevision(revisionId));
      setMessage({ kind: "ok", text: "نسخهٔ انتخابی به‌صورت پیش‌نویس تازه بازیابی شد؛ برای اعمال، آن را منتشر کنید." });
    } catch (error) {
      setMessage({ kind: "error", text: siteDesignErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const draftDirty = Boolean(state?.draft) && state?.draft?.id !== state?.published?.id;
  const sectionsCount = (payload: Partial<SiteSettings> | undefined) => Object.keys(payload ?? {}).length;

  return <section className="space-y-4 rounded-[6px] border border-neutral-200 bg-white p-5" aria-label="انتشار و تاریخچهٔ طراحی">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[13px] font-medium">انتشار و تاریخچه</h2>
        <p className="mt-1 max-w-xl text-[10.5px] leading-5 text-neutral-500">ذخیره‌ها ابتدا به‌صورت پیش‌نویس در سرور می‌مانند؛ با «انتشار» روی فروشگاه زنده می‌نشینند. هر انتشار یک نسخهٔ بازگشت‌پذیر می‌سازد.</p>
      </div>
      <span className="rounded-full border border-neutral-200 px-3 py-1 text-[10px] text-neutral-600">
        {saveState.state === "saving" ? "در حال ذخیره…" : saveState.state === "saved" ? "پیش‌نویس ذخیره شد" : saveState.state === "error" ? "خطای ذخیره" : "بدون تغییر تازه"}
      </span>
    </header>

    {saveState.error ? <p role="alert" className="rounded-[5px] border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] text-amber-800">{saveState.error}</p> : null}
    {message ? <p role="status" className={`rounded-[5px] border px-3 py-2 text-[10.5px] ${message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{message.text}</p> : null}

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-[5px] border border-neutral-200 p-3">
        <p className="text-[9px] tracking-[0.18em] text-neutral-400">نسخهٔ زنده</p>
        {busy === "load" && !state ? <p className="mt-2 text-[11px] text-neutral-500">در حال بارگذاری…</p> : state?.published ? <>
          <p className="mt-2 text-[11.5px] font-medium">{whenFa(state.published.publishedAt ?? state.published.createdAt)}</p>
          <p className="mt-1 text-[10px] text-neutral-500">{numberFa(sectionsCount(state.published.payload))} بخش · نسخهٔ {state.published.id.slice(0, 6)}</p>
        </> : <p className="mt-2 text-[11px] text-neutral-500">هنوز نسخه‌ای منتشر نشده است.</p>}
      </div>
      <div className="rounded-[5px] border border-neutral-200 p-3">
        <p className="text-[9px] tracking-[0.18em] text-neutral-400">پیش‌نویس فعال</p>
        {state?.draft ? <>
          <p className="mt-2 text-[11.5px] font-medium">{whenFa(state.draft.createdAt)}</p>
          <p className="mt-1 text-[10px] text-neutral-500">{numberFa(sectionsCount(state.draft.payload))} بخش · {draftDirty ? "منتشر نشده" : "هم‌سان با نسخهٔ زنده"}</p>
        </> : <p className="mt-2 text-[11px] text-neutral-500">پیش‌نویسی ذخیره نشده است؛ با نخستین تغییر ساخته می‌شود.</p>}
      </div>
    </div>

    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-[220px] flex-1">
        <span className="block text-[10px] text-neutral-500">یادداشت این انتشار (اختیاری)</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="مثلاً: تغییر رنگ دکمه‌ها و فوتر" className="mt-1 w-full rounded-[5px] border border-neutral-300 px-3 py-2 text-[11px]" />
      </label>
      <button type="button" onClick={() => void publish()} disabled={busy !== null || !state?.draft} className="rounded-[5px] bg-[var(--kv-primary)] px-4 py-2.5 text-[11px] text-white disabled:opacity-45">
        {busy === "publish" ? "در حال انتشار…" : "انتشار روی فروشگاه"}
      </button>
    </div>

    <div>
      <h3 className="text-[11.5px] font-medium">تاریخچهٔ نسخه‌ها</h3>
      {state && state.revisions.length > 0 ? <ul className="mt-2 divide-y divide-neutral-100 text-[10.5px]">
        {state.revisions.map((revision) => <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[9.5px] ${revision.status === "published" ? "bg-emerald-50 text-emerald-700" : revision.status === "draft" ? "bg-[var(--kv-surface-muted)] text-[var(--kv-primary)]" : "bg-neutral-100 text-neutral-500"}`}>{statusLabel[revision.status]}</span>
            <span>{whenFa(revision.publishedAt ?? revision.createdAt)}</span>
            {revision.note ? <span className="text-neutral-400">· {revision.note}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            {revision.status === "published" ? <span className="text-emerald-700">زنده</span> : <button type="button" disabled={busy !== null} onClick={() => void restore(revision.id)} className="rounded-[4px] border border-neutral-300 px-3 py-1.5 text-[10px] hover:border-[var(--kv-primary)] disabled:opacity-45">بازگردانی به پیش‌نویس</button>}
          </span>
        </li>)}
      </ul> : <p className="mt-2 text-[10.5px] text-neutral-500">تاریخچه‌ای وجود ندارد. با نخستین ذخیره، این فهرست پر می‌شود.</p>}
    </div>

    <p className="flex items-center gap-2 text-[10px] text-neutral-400"><Icon name="shield" className="h-3.5 w-3.5" />هر ذخیره و انتشار در دفتر حسابرسی سرور با نام کاربر ثبت می‌شود.</p>
    <p className="sr-only">تنظیمات فعلی صفحه: {Object.keys(settings).length} بخش</p>
  </section>;
}
