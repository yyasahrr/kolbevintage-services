import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

export type SurfaceVariant = "default" | "elevated" | "glass" | "subtle";
export type Density = "comfortable" | "compact";
export type Intent = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & { surface?: SurfaceVariant; density?: Density };
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface({ surface = "default", density = "comfortable", className = "", ...props }, ref) {
  return <div {...props} ref={ref} className={`kolbe-surface ${className}`.trim()} data-surface={surface} data-density={density} />;
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", className = "", type = "button", ...props }, ref) {
  return <button {...props} ref={ref} type={type} data-variant={variant} className={`kolbe-button ${className}`.trim()} />;
});

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="kolbe-visually-hidden">{children}</span>;
}
