import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'zt_session';
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest'];

/**
 * První vrstva ochrany: bez cookie relace přesměruje na /login (API vrací 401).
 * Samotnou platnost relace ověřuje každá stránka, server action i API na serveru
 * (src/lib/auth.ts) a databáze navíc vynucuje Row Level Security.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  const hasSession = !!request.cookies.get(SESSION_COOKIE)?.value;
  if (!hasSession && !isPublic) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 });
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png|icons/|apple-touch-icon.png|sw.js).*)'],
};
