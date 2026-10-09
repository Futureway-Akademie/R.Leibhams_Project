import type { InputHTMLAttributes, ReactNode } from 'react';

/** Eingabefeld mit Beschriftung, optionalem Hinweis und Fehlermeldung (verknüpft per aria). */
export function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  className,
  ...input
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  className?: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'value' | 'onChange' | 'className'
>): ReactNode {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Fokussiert ein Feld nach dem nächsten Rendern (z. B. erstes fehlerhaftes Feld). */
export function focusLater(id: string): void {
  requestAnimationFrame(() => {
    document.getElementById(id)?.focus();
  });
}
