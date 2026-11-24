import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCspHeader, generateCspNonce } from '@/lib/csp';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { shouldBypassSessionAuth } from '@/lib/middleware-rules';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = generateCspNonce();
  const csp = buildCspHeader({
    nonce,
    isDev: process.env.NODE_ENV !== 'production',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    streetTileUrl: process.env.NEXT_PUBLIC_MAP_STREET_TILE_URL,
    satelliteTileUrl: process.env.NEXT_PUBLIC_MAP_SATELLITE_TILE_URL,
  });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const withCsp = <T extends NextResponse>(response: T): T => {
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };
  const nextWithCsp = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  if (shouldBypassSessionAuth(pathname, req.method)) {
    return nextWithCsp();
  }
  const isLoginRoute = pathname.startsWith('/login');
  const isApiRoute = pathname.startsWith('/api/');
  const { url, key, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    if (isApiRoute) {
      return withCsp(
        NextResponse.json(
          { error: 'Supabase environment variables are not configured.' },
          { status: 503 },
        ),
      );
    }
    if (isLoginRoute) {
      return nextWithCsp();
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('error', 'missing_config');
    return withCsp(NextResponse.redirect(loginUrl));
  }

  let res = nextWithCsp();

  try {
    const sb = createServerClient(url, key, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = nextWithCsp();
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });

    // Fast local session check in middleware; Server Components & API routes verify via getUser().
    const {
      data: { session },
    } = await sb.auth.getSession();

    if (!session) {
      if (isApiRoute) {
        return withCsp(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
      }
      if (!isLoginRoute) {
        return withCsp(NextResponse.redirect(new URL('/login', req.url)));
      }
      return res;
    }

    if (isLoginRoute) {
      return withCsp(NextResponse.redirect(new URL('/', req.url)));
    }

    return res;
  } catch (err) {
    console.error('Middleware auth error:', err);
    if (isApiRoute) {
      return withCsp(NextResponse.json({ error: 'Authentication check failed' }, { status: 500 }));
    }
    if (!isLoginRoute) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('error', 'auth_error');
      return withCsp(NextResponse.redirect(loginUrl));
    }
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
