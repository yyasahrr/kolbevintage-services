import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ErrorState, LoadingState } from "../../shared/components";

export function VipRoutePage({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <section className="vip-route-page" aria-labelledby="vip-route-title"><header className="vip-route-page__header"><p>{eyebrow}</p><h1 id="vip-route-title">{title}</h1><span>{description}</span></header>{children}</section>;
}

export function useRemote<T>(load: () => Promise<T>, deps: readonly unknown[] = []) {
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true });
  const reload = useCallback(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    void load().then((data) => { if (active) setState({ loading: false, data }); }).catch((reason: unknown) => { if (active) setState({ loading: false, error: reason instanceof Error ? reason.message : "خطای نامشخص" }); });
    return () => { active = false; };
  // load is intentionally represented by the caller-supplied dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  const setData = useCallback((update: (current: T | undefined) => T | undefined) => setState((current) => ({ ...current, data: update(current.data) })), []);
  return { ...state, reload, setData };
}

export function RemoteBoundary<T>({ state, children }: { state: { loading: boolean; data?: T; error?: string; reload: () => unknown }; children: (data: T) => ReactNode }) {
  if (state.loading && !state.data) return <LoadingState label="در حال دریافت اطلاعات از سرور" />;
  if (state.error) return <ErrorState title="دریافت اطلاعات ممکن نشد" description={state.error} onRetry={() => { state.reload(); }} />;
  return state.data ? <>{children(state.data)}</> : null;
}

export const faDate = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
export const statusLabel = (status: string) => ({ pending: "در انتظار", accepted: "پذیرفته", revision_requested: "نیازمند بازبینی", cancelled: "لغوشده", created: "ثبت‌شده", processing: "در پردازش", shipped: "ارسال‌شده", delivered: "تحویل‌شده", issued: "صادرشده", open: "باز", active: "فعال" }[status.toLowerCase()] ?? status.replaceAll("_", " "));
