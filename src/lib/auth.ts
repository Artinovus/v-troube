import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSql } from './db/client';
import { withUserTx, type Tx } from './db/rls';
import { DUMMY_HASH, hashPassword, hashToken, newSessionToken, passwordProblem, verifyPassword } from './password';

export const SESSION_COOKIE = 'zt_session';
export const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export class AuthError extends Error {
  constructor(public code: 'unauthenticated' | 'forbidden') {
    super(code === 'unauthenticated' ? 'Nejste přihlášeni.' : 'Nemáte oprávnění.');
  }
}

export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  sessionId: string;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_DAYS * 24 * 3600,
});

/**
 * Ověří relaci na serveru: token z HTTP‑only cookie se porovná s otiskem
 * v tabulce app_sessions (platnost, existence uživatele).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const sql = getSql();
  const rows = await sql`
    select s.id as session_id, s.last_seen_at, u.id, u.email, u.role
    from public.app_sessions s join public.app_users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now()`;
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) {
    await sql`update public.app_sessions set last_seen_at = now() where id = ${r.session_id}`;
  }
  return { id: r.id, email: r.email, role: r.role, sessionId: r.session_id };
});

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(email: string, password: string, userAgent: string | null): Promise<LoginResult> {
  const sql = getSql();
  const [user] = await sql`select id, password_hash, failed_login_attempts, locked_until from public.app_users where lower(email) = lower(${email})`;
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    return { ok: false, error: `Příliš mnoho neúspěšných pokusů. Zkuste to znovu za ${LOCK_MINUTES} minut.` };
  }
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    if (user) {
      await sql`
        update public.app_users set
          failed_login_attempts = failed_login_attempts + 1,
          locked_until = case when failed_login_attempts + 1 >= ${MAX_FAILED} then now() + make_interval(mins => ${LOCK_MINUTES}) else null end
        where id = ${user.id}`;
    }
    return { ok: false, error: 'Nesprávný e-mail nebo heslo.' };
  }
  const token = newSessionToken();
  await sql.begin(async (tx) => {
    await tx`update public.app_users set failed_login_attempts = 0, locked_until = null, last_login_at = now() where id = ${user.id}`;
    await tx`delete from public.app_sessions where expires_at < now()`;
    await tx`
      insert into public.app_sessions (user_id, token_hash, expires_at, user_agent)
      values (${user.id}, ${hashToken(token)}, now() + make_interval(days => ${SESSION_DAYS}), ${userAgent?.slice(0, 300) ?? null})`;
  });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
  return { ok: true };
}

export async function logout() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await getSql()`delete from public.app_sessions where token_hash = ${hashToken(token)}`;
  store.delete(SESSION_COOKIE);
}

export async function changePassword(user: SessionUser, current: string, next: string): Promise<LoginResult> {
  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem };
  const sql = getSql();
  const [row] = await sql`select password_hash from public.app_users where id = ${user.id}`;
  if (!row || !(await verifyPassword(current, row.password_hash))) return { ok: false, error: 'Současné heslo není správné.' };
  const hash = await hashPassword(next);
  await sql.begin(async (tx) => {
    await tx`update public.app_users set password_hash = ${hash}, password_changed_at = now() where id = ${user.id}`;
    // ostatní zařízení se odhlásí
    await tx`delete from public.app_sessions where user_id = ${user.id} and id <> ${user.sessionId}`;
  });
  return { ok: true };
}

export async function logoutOtherSessions(user: SessionUser) {
  await getSql()`delete from public.app_sessions where user_id = ${user.id} and id <> ${user.sessionId}`;
}

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
