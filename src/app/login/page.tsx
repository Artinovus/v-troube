import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { signOutAction } from './actions';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Přihlášení' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto rounded-2xl" />
          <h1 className="mt-4 text-2xl font-semibold">Z trouby</h1>
          <p className="mt-1 text-sm text-ink-soft">Náklady, receptury a ceny pekárny</p>
        </div>
        {error === 'forbidden' ? (
          <div className="mb-4 rounded-lg border border-bad/30 bg-bad-bg p-3 text-sm text-bad">
            Tento účet nemá oprávnění administrátora.
            <form action={signOutAction} className="mt-2">
              <Button variant="outline" size="sm" type="submit">Odhlásit se</Button>
            </form>
          </div>
        ) : null}
        <LoginForm />
        <p className="mt-6 text-center text-xs text-ink-muted">Registrace není veřejná. Účet zakládá správce aplikace.</p>
      </div>
    </main>
  );
}
