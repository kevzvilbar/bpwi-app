import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv } from '@/lib/supabase/env';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLoginRoute = pathname.startsWith('/login');
  const isApiRoute = pathname.startsWith('/api/');
  const { url, key, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'Supabase environment variables are not configured.' },
        { status: 503 },
      );
    }
    if (isLoginRoute) {
      return NextResponse.next({ request: req });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('error', 'missing_config');
    return NextResponse.redirect(loginUrl);
  }

  let res = NextResponse.next({ request: req });

  try {
    const sb = createServerClient(url, key, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });

    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) {
      if (isApiRoute) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!isLoginRoute) {
        return NextResponse.redirect(new URL('/login', req.url));
      }
      return res;
    }

    if (isLoginRoute) {
      return NextResponse.redirect(new URL('/', req.url));
    }

    return res;
  } catch (err) {
    console.error('Middleware auth error:', err);
    if (isApiRoute) {
      return NextResponse.json({ error: 'Authentication check failed' }, { status: 500 });
    }
    if (!isLoginRoute) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('error', 'auth_error');
      return NextResponse.redirect(loginUrl);
    }
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
