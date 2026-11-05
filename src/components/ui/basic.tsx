import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-line bg-paper px-3 text-ink placeholder:text-ink-muted focus:border-brown-soft focus:outline-none focus:ring-2 focus:ring-brown/20 disabled:opacity-60 aria-[invalid=true]:border-bad',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink placeholder:text-ink-muted focus:border-brown-soft focus:outline-none focus:ring-2 focus:ring-brown/20',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-line bg-paper px-3 text-ink focus:border-brown-soft focus:outline-none focus:ring-2 focus:ring-brown/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-sm font-medium text-ink-soft', className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 rounded-xl border border-line bg-paper p-4 shadow-[0_1px_2px_rgba(59,42,30,0.04)]', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-semibold text-ink', className)} {...props} />;
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'brown';
const tones: Record<Tone, string> = {
  neutral: 'bg-sand text-ink-soft',
  good: 'bg-good-bg text-good',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  brown: 'bg-brown/10 text-brown-dark',
};
export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor?: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sand-strong bg-paper/60 p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{text}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'warn', children, className }: { tone?: 'warn' | 'bad' | 'good' | 'neutral'; children: React.ReactNode; className?: string }) {
  const cls = { warn: 'border-warn/30 bg-warn-bg text-warn', bad: 'border-bad/30 bg-bad-bg text-bad', good: 'border-good/30 bg-good-bg text-good', neutral: 'border-line bg-sand text-ink-soft' }[tone];
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('rounded-lg border px-3 py-2 text-sm', cls, className)}>{children}</div>;
}
