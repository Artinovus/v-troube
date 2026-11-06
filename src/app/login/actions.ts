'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { login, logout } from '@/lib/auth';

const schema = z.object({
  email: z.email({ error: 'Zadejte platný e-mail.' }).max(200),
  password: z.string().min(1, 'Zadejte heslo.').max(200),
});

export async function signInAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const res = await login(parsed.data.email.trim(), parsed.data.password, (await headers()).get('user-agent'));
  if (!res.ok) return { error: res.error };
  redirect('/');
}

export async function signOutAction() {
  await logout();
  redirect('/login');
}
