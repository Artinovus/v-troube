import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from './supabase/server';
import { withUserTx, type Tx } from './db/rls';

export class AuthError extends Error {
  constructor(public code: 'unauthenticated' | 'forbidden') {
    super(code === 'unauthenticated' ? 'Nejste přihlášeni.' : 'Nemáte oprávnění.');
  }
}

export interface SessionUser {
  id: string;
  email: string | null;
  role: 'admin' | 'user';
}

/**
 * Ověří relaci na serveru. getUser() ověřuje token u Supabase Auth
 * (nespoléhá na nepodepsaná data v cookies).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const uid = data.user.id;
  const rows = await withUserTx(uid, (tx) => tx`select role from public.profiles where id = ${uid}`);
  const role = (rows[0]?.role as SessionUser['role'] | undefined) ?? 'user';
  return { id: uid, email: data.user.email ?? null, role };
});

/** Pro stránky: nepřihlášeného přesměruje na /login. */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/login?error=forbidden');
  return user;
}

/** Pro server actions a API: vyhodí AuthError. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('unauthenticated');
  if (user.role !== 'admin') throw new AuthError('forbidden');
  return user;
}

export async function withAdminTx<T>(fn: (tx: Tx, user: SessionUser) => Promise<T>): Promise<T> {
  const user = await requireAdmin();
  return withUserTx(user.id, (tx) => fn(tx, user));
}
