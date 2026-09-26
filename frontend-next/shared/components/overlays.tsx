import { X } from "lucide-react";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";

type OverlayProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; className?: string };

function useNativeDialog(open: boolean, onOpenChange: (open: boolean) => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocus.current = globalThis.document?.activeElement as HTMLElement | null;
      dialog.showModal();
      const body = globalThis.document?.body;
      if (body) body.style.overflow = "hidden";
      requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[autofocus], button, [href], input, select, textarea")?.focus());
    } else if (!open && dialog.open) dialog.close();
    return () => {
      const body = globalThis.document?.body;
      if (body) body.style.overflow = "";
    };
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const close = () => { onOpenChange(false); restoreFocus.current?.focus(); };
    dialog.addEventListener("close", close);
    return () => dialog.removeEventListener("close", close);
  }, [onOpenChange]);
  return ref;
}

function OverlayFrame({ variant, open, onOpenChange, title, description, children, footer, className = "" }: OverlayProps & { variant: "dialog" | "drawer" | "sheet" }) {
  const ref = useNativeDialog(open, onOpenChange);
  const titleId = useId();
  const descriptionId = useId();
  const handleBackdrop = (event: MouseEvent<HTMLDialogElement>) => { if (event.target === event.currentTarget) onOpenChange(false); };
  return <dialog ref={ref} className={`kolbe-overlay kolbe-overlay--${variant} ${className}`.trim()} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); onOpenChange(false); }} onClick={handleBackdrop}>
    <section className="kolbe-overlay__surface"><header><div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div><button type="button" className="kolbe-icon-button" aria-label="بستن" onClick={() => onOpenChange(false)}><X aria-hidden="true" /></button></header><div className="kolbe-overlay__content">{children}</div>{footer ? <footer>{footer}</footer> : null}</section>
  </dialog>;
}

export function Dialog(props: OverlayProps) { return <OverlayFrame {...props} variant="dialog" />; }
export function Drawer(props: OverlayProps) { return <OverlayFrame {...props} variant="drawer" />; }
export function Sheet(props: OverlayProps) { return <OverlayFrame {...props} variant="sheet" />; }

export function Popover({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  return <details className="kolbe-popover"><summary aria-label={label}>{trigger}</summary><div className="kolbe-popover__surface">{children}</div></details>;
}
