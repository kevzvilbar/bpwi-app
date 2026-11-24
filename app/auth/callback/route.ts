import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { classifyOAuthError, sanitizeNextPath } from '@/lib/auth-redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const errorCode = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');
  const nextPath = sanitizeNextPath(url.searchParams.get('next'));

  if (errorCode || errorDesc) {
    const reason = classifyOAuthError(errorCode, errorDesc);
    return NextResponse.redirect(new URL(`/login?error=oauth_error&reason=${reason}`, url.origin));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=auth_error', url.origin));
  }

  try {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) {
      const reason = classifyOAuthError(null, error.message);
      return NextResponse.redirect(new URL(`/login?error=oauth_error&reason=${reason}`, url.origin));
    }
    return NextResponse.redirect(new URL(nextPath, url.origin));
  } catch {
    return NextResponse.redirect(new URL('/login?error=auth_error', url.origin));
  }
}
