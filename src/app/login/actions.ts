'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const schema = z.object({
  email: z.email({ error: 'Zadejte platný e-mail.' }).max(200),
  password: z.string().min(1, 'Zadejte heslo.').max(200),
});

export async function signInAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Neprozrazujeme, zda účet existuje.
    return { error: 'Nesprávný e-mail nebo heslo.' };
  }
  redirect('/');
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
