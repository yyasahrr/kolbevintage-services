/**
 * PasswordField - Shared accessible password input component
 * 
 * Part of the Kolbe Fluid Heritage design system.
 * Integrates with existing shared architecture (shared/design/, shared/session/).
 * 
 * Requirements (from global redesign spec):
 * - show/hide eye button
 * - button type=button
 * - accessible label: "نمایش رمز عبور" / "پنهان کردن رمز عبور"
 * - aria-pressed
 * - keyboard support
 * - focus-visible
 * - no field-width jump
 * - RTL-safe
 * - password manager friendly
 */

import React, { forwardRef, useState, useRef, type InputHTMLAttributes } from 'react';

export type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  /** The password value (controlled) */
  value: string;
  /** Called when the password changes */
  onChange: (value: string) => void;
  /** Label for the field (used for accessibility) */
  label?: string;
  /** Error message to display */
  error?: string;
  /** Hint text to display below the field */
  hint?: string;
  /** Whether to show the visibility toggle button (default: true) */
  showVisibilityToggle?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** HTML id (auto-generated if not provided) */
  id?: string;
  /** Autocomplete attribute (default: 'current-password') */
  autoComplete?: string;
};

/**
 * PasswordField component with full accessibility support.
 * 
 * Usage:
 * ```tsx
 * <PasswordField
 *   value={password}
 *   onChange={setPassword}
 *   label="رمز عبور"
 *   placeholder="رمز عبور خود را وارد کنید"
 *   error={error}
 *   hint="حداقل ۸ کاراکتر"
 * />
 * ```
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  (
    {
      value,
      onChange,
      label,
      error,
      hint,
      showVisibilityToggle = true,
      disabled = false,
      placeholder,
      className,
      id,
      autoComplete = 'current-password',
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    
    // Generate unique ID if not provided
    const generatedId = id || `password-${Math.random().toString(36).substr(2, 9)}`;
    const isError = !!error;
    
    const togglePasswordVisibility = () => {
      setShowPassword((prev) => !prev);
      // Focus the input after toggling for better UX
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePasswordVisibility();
      }
    };
    
    return (
      <div className={`kolbe-password-field ${className || ''}`}>
        {label && (
          <label
            htmlFor={generatedId}
            className="block text-[10.5px] text-neutral-500 mb-1.5"
          >
            {label}
          </label>
        )}
        
        <div className="relative">
          <input
            ref={inputRef}
            id={generatedId}
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete={autoComplete}
            aria-label={label || 'رمز عبور'}
            aria-describedby={isError ? `${generatedId}-error` : hint ? `${generatedId}-hint` : undefined}
            aria-invalid={isError}
            className={`
              w-full h-11 pr-11 pl-3 text-[12px]
              bg-white
              border ${isError ? 'border-red-500' : isFocused ? 'border-brand-primary' : 'border-neutral-300'}
              text-neutral-900
              outline-none
              transition-colors duration-120
              focus-visible:ring-2 focus-visible:ring-brand-primary
              disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400
              ${disabled ? 'opacity-50' : ''}
            `}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            {...props}
          />
          
          {showVisibilityToggle && !disabled && (
            <button
              ref={buttonRef}
              type="button"
              onClick={togglePasswordVisibility}
              onKeyDown={handleKeyDown}
              aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
              aria-pressed={showPassword}
              className="
                absolute right-3 top-1/2 -translate-y-1/2
                h-6 w-6 flex items-center justify-center
                text-neutral-400 hover:text-brand-primary
                transition-colors duration-120
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary
              "
            >
              {/* Eye icon - SVG for no external dependencies */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-4 w-4"
                aria-hidden="true"
              >
                {showPassword ? (
                  // Eye off icon
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  // Eye icon
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          )}
        </div>
        
        {hint && !isError && (
          <p
            id={`${generatedId}-hint`}
            className="mt-1.5 text-[9px] text-neutral-500"
          >
            {hint}
          </p>
        )}
        
        {isError && (
          <p
            id={`${generatedId}-error`}
            role="alert"
            className="mt-1.5 text-[10.5px] text-red-600"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);

PasswordField.displayName = 'PasswordField';

export default PasswordField;
