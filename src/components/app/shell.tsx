'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Wheat, BookOpen, Tag, Calculator, Coffee, Settings, LogOut, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/login/actions';

const NAV = [
  { href: '/', label: 'Přehled', short: 'Přehled', icon: LayoutDashboard },
  { href: '/ingredients', label: 'Suroviny', short: 'Suroviny', icon: Wheat },
  { href: '/recipes', label: 'Receptury', short: 'Receptury', icon: BookOpen },
  { href: '/products', label: 'Výrobky a ceny', short: 'Výrobky', icon: Tag },
  { href: '/calculator', label: 'Kalkulačka', short: 'Kalkulace', icon: Calculator },
  { href: '/cafe-profit', label: 'Zisk kavárny', short: 'Kavárna', icon: Coffee },
  { href: '/settings', label: 'Nastavení', short: 'Nastavení', icon: Settings },
];

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function AppShell({ email, children }: { email: string | null; children: React.ReactNode }) {
  const path = usePathname();
  const online = useOnline();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-paper/70 p-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={32} height={32} className="rounded-lg" />
          <span className="text-lg font-semibold">Z trouby</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Hlavní navigace">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', active(n.href) ? 'bg-sand font-medium text-ink' : 'text-ink-soft hover:bg-sand/60')}>
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line pt-3 text-xs text-ink-muted">
          <p className="truncate px-2" title={email ?? ''}>{email}</p>
          <form action={signOutAction}>
            <button type="submit" className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-sand">
              <LogOut className="size-4" /> Odhlásit se
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-cream/90 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={28} height={28} className="rounded-md" />
            <span className="font-semibold">Z trouby</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/settings" aria-label="Nastavení" className={cn('rounded-lg p-2', active('/settings') ? 'bg-sand' : 'text-ink-soft')}>
              <Settings className="size-5" />
            </Link>
            <form action={signOutAction}>
              <button type="submit" aria-label="Odhlásit se" className="rounded-lg p-2 text-ink-soft">
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
        </header>
        {!online ? (
          <div role="alert" className="flex items-center justify-center gap-2 bg-warn-bg px-4 py-2 text-sm text-warn">
            <WifiOff className="size-4" /> Jste offline. Změny se neuloží, dokud se připojení neobnoví.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>
      </div>

      <nav aria-label="Navigace" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-paper/95 backdrop-blur pb-safe md:hidden">
        {NAV.filter((n) => n.href !== '/settings').map((n) => (
          <Link key={n.href} href={n.href} className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', active(n.href) ? 'font-semibold text-brown' : 'text-ink-muted')}>
            <n.icon className="size-5" />
            {n.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}
