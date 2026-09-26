import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type MutableRefObject, type Ref } from "react";

export type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string;
  hint?: string;
  showVisibilityToggle?: boolean;
};

function setInputRef(node: HTMLInputElement | null, forwarded: Ref<HTMLInputElement>, local: MutableRefObject<HTMLInputElement | null>) {
  local.current = node;
  if (typeof forwarded === "function") forwarded(node);
  else if (forwarded) forwarded.current = node;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { value, onChange, label, error, hint, showVisibilityToggle = true, disabled = false, className = "", id, autoComplete = "current-password", ...inputProps },
  forwardedRef,
) {
  const reactId = useId();
  const fieldId = id ?? `kolbe-password-${reactId.replace(/:/g, "")}`;
  const hintId = hint && !error ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [visible, setVisible] = useState(false);

  const toggleVisibility = () => {
    setVisible((current) => !current);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className={`kolbe-field ${className}`.trim()} data-invalid={error ? "true" : undefined}>
      <label className="kolbe-field__label" htmlFor={fieldId}>{label}</label>
      <div className="kolbe-field__control kolbe-password-field__control">
        <input
          {...inputProps}
          ref={(node) => setInputRef(node, forwardedRef, inputRef)}
          id={fieldId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className="kolbe-input kolbe-password-field__input"
        />
        {showVisibilityToggle ? (
          <button type="button" className="kolbe-icon-button kolbe-password-field__toggle" onClick={toggleVisibility} disabled={disabled} aria-label={visible ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} aria-pressed={visible}>
            {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {hintId ? <p id={hintId} className="kolbe-field__hint">{hint}</p> : null}
      {errorId ? <p id={errorId} className="kolbe-field__error" role="alert">{error}</p> : null}
    </div>
  );
});

export default PasswordField;
