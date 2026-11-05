import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/offline'];

/**
 * Obnovuje relaci Supabase v cookies a nepřihlášené uživatele přesměruje na /login.
 * Jde o první vrstvu ochrany – každá stránka, server action i API znovu ověřuje
 * uživatele na serveru (src/lib/auth.ts) a databáze vynucuje RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new NextResponse('Aplikace není nakonfigurována.', { status: 500 });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));

  if (!data.user && !isPublic) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    const redirect = NextResponse.redirect(login);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  if (data.user && path === '/login' && !request.nextUrl.searchParams.has('error')) {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png|icons/|apple-touch-icon.png|sw.js).*)'],
};
