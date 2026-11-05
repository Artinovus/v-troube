'use client';
import * as React from 'react';
import { Check, CloudOff, Loader2, AlertCircle, Pencil } from 'lucide-react';
import type { ActionResult } from '@/lib/validation';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline';

/**
 * Automatické ukládání se zpožděním. Stav „Uloženo“ se zobrazí jen po skutečném
 * potvrzení serverem; bez připojení zůstávají změny označené jako neuložené.
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<ActionResult<unknown>>, opts: { delay?: number; enabled?: boolean } = {}) {
  const { delay = 900, enabled = true } = opts;
  const [state, setState] = React.useState<SaveState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const serialized = JSON.stringify(value);
  const lastSaved = React.useRef(serialized);
  const pending = React.useRef<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = React.useRef(save);
  saveRef.current = save;
  const inFlight = React.useRef(false);

  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (next == null || inFlight.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setState('offline');
      return;
    }
    inFlight.current = true;
    setState('saving');
    let succeeded = false;
    try {
      const res = await saveRef.current(JSON.parse(next) as T);
      if (res.ok) {
        lastSaved.current = next;
        succeeded = true;
        if (pending.current === next) pending.current = null;
        setError(null);
        setState(pending.current ? 'dirty' : 'saved');
      } else {
        setError(res.error);
        setState('error');
      }
    } catch {
      setError('Spojení se serverem selhalo – změny nejsou uložené.');
      setState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    } finally {
      inFlight.current = false;
      if (succeeded && pending.current && pending.current !== lastSaved.current) {
        timer.current = setTimeout(flush, delay);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  React.useEffect(() => {
    if (serialized === lastSaved.current) return;
    pending.current = serialized;
    if (!enabled) {
      setState('dirty');
      return;
    }
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [serialized, enabled, delay, flush]);

  React.useEffect(() => {
    const onOnline = () => pending.current && enabled && flush();
    const onOffline = () => pending.current && setState('offline');
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current && pending.current !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [enabled, flush]);

  // Při odchodu ze stránky uložit rozpracované změny okamžitě.
  React.useEffect(() => {
    return () => {
      if (enabled && pending.current && pending.current !== lastSaved.current) void flush();
    };
  }, [enabled, flush]);

  return { state, error, flush, retry: flush };
}

export function SaveIndicator({ state, error, onRetry }: { state: SaveState; error?: string | null; onRetry?: () => void }) {
  const base = 'inline-flex items-center gap-1.5 text-xs font-medium';
  switch (state) {
    case 'dirty':
      return <span className={`${base} text-ink-muted`} aria-live="polite"><Pencil className="size-3.5" />Neuložené změny</span>;
    case 'saving':
      return <span className={`${base} text-ink-soft`} aria-live="polite"><Loader2 className="size-3.5 animate-spin" />Ukládám…</span>;
    case 'saved':
      return <span className={`${base} text-good`} aria-live="polite"><Check className="size-3.5" />Uloženo</span>;
    case 'offline':
      return <span className={`${base} text-warn`} role="status"><CloudOff className="size-3.5" />Offline – změny nejsou uložené</span>;
    case 'error':
      return (
        <span className={`${base} text-bad`} role="alert">
          <AlertCircle className="size-3.5" />
          {error ?? 'Uložení selhalo'}
          {onRetry ? <button type="button" className="underline" onClick={onRetry}>Zkusit znovu</button> : null}
        </span>
      );
    default:
      return null;
  }
}
