import { Search } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export type FormFieldProps = {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (field: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
};

export function FormField({ id, label, hint, error, required, children }: FormFieldProps) {
  const generated = useId().replace(/:/g, "");
  const fieldId = id ?? `kolbe-field-${generated}`;
  const hintId = hint && !error ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className="kolbe-field" data-invalid={error ? "true" : undefined}>
      <label className="kolbe-field__label" htmlFor={fieldId}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children({ id: fieldId, describedBy: errorId ?? hintId, invalid: Boolean(error) })}
      {hintId ? <p className="kolbe-field__hint" id={hintId}>{hint}</p> : null}
      {errorId ? <p className="kolbe-field__error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & { id?: string; label: string; hint?: string; error?: string };
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ id, label, hint, error, required, className = "", ...props }, ref) {
  return <FormField id={id} label={label} hint={hint} error={error} required={required}>{(field) => (
    <input {...props} ref={ref} id={field.id} required={required} aria-invalid={field.invalid || undefined} aria-describedby={field.describedBy} className={`kolbe-input ${className}`.trim()} />
  )}</FormField>;
});

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: string };
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ label = "جستجو", className = "", ...props }, ref) {
  return <label className={`kolbe-search-field ${className}`.trim()}><span className="kolbe-visually-hidden">{label}</span><Search aria-hidden="true" /><input {...props} ref={ref} type="search" aria-label={label} /></label>;
});

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string };
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField({ id, label, hint, error, required, className = "", children, ...props }, ref) {
  return <FormField id={id} label={label} hint={hint} error={error} required={required}>{(field) => (
    <select {...props} ref={ref} id={field.id} required={required} aria-invalid={field.invalid || undefined} aria-describedby={field.describedBy} className={`kolbe-input kolbe-select ${className}`.trim()}>{children}</select>
  )}</FormField>;
});
