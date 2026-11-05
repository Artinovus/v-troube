'use client';
import * as React from 'react';
import { Input } from '@/components/ui/basic';
import { parseCzNumber, toInputValue } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface NumberFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | null;
  onValueChange: (v: number | null) => void;
  suffix?: string;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
}

/**
 * Číselné pole s českou desetinnou čárkou. Neplatný vstup se neodešle a pole
 * se označí jako chybné; uložená hodnota zůstává poslední platná.
 */
export function NumberField({ value, onValueChange, suffix, min = 0, max, allowEmpty = true, className, onBlur, ...props }: NumberFieldProps) {
  const [text, setText] = React.useState(toInputValue(value));
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);

  React.useEffect(() => {
    if (!focused) {
      const parsed = parseCzNumber(text);
      if (parsed !== value) setText(toInputValue(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const validate = (n: number | null) => {
    if (n == null) return allowEmpty;
    if (Number.isNaN(n)) return false;
    if (min != null && n < min) return false;
    if (max != null && n > max) return false;
    return true;
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        className={cn('num', suffix && 'pr-12')}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseCzNumber(e.target.value);
          const ok = validate(n);
          setInvalid(!ok);
          if (ok) onValueChange(n);
        }}
        onBlur={(e) => {
          setFocused(false);
          const n = parseCzNumber(text);
          if (validate(n)) setText(toInputValue(n));
          onBlur?.(e);
        }}
      />
      {suffix ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-muted">{suffix}</span> : null}
    </div>
  );
}
