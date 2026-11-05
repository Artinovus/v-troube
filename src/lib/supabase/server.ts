import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Chybí NEXT_PUBLIC_SUPABASE_URL nebo NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  return { url, key };
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Volání ze Server Component – cookies obnovuje proxy.
        }
      },
    },
  });
}
