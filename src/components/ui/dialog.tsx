'use client';
import * as React from 'react';
import { Dialog as D, AlertDialog as AD } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Dialog({ open, onOpenChange, title, description, children, className }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]" />
        <D.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-paper p-5 shadow-xl pb-safe sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            className,
          )}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-lg font-semibold text-ink">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-ink-soft">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Zavřít">
                <X />
              </Button>
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Potvrdit', destructive, onConfirm, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; destructive?: boolean; onConfirm: () => void | Promise<void>; children?: React.ReactNode }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-paper p-5 shadow-xl">
          <AD.Title className="text-lg font-semibold text-ink">{title}</AD.Title>
          <AD.Description asChild>
            <div className="mt-2 text-sm text-ink-soft">{description}</div>
          </AD.Description>
          {children}
          <div className="mt-5 flex justify-end gap-2">
            <AD.Cancel asChild>
              <Button variant="outline">Zrušit</Button>
            </AD.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Pracuji…' : confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
