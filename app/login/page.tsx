'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { getErrorMessage } from '@/lib/error-utils';
import { getOAuthErrorMessage } from '@/lib/auth-redirect';
import { AlertBanner, SegmentedTabs } from '@/components/ui';

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get('error');
  const urlReason = params.get('reason');
  const { isConfigured } = getSupabaseEnv();
  const publicSignupEnabled = process.env.NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP === 'true';

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<'google' | 'facebook' | null>(null);
  const oauthLoading = oauthProvider !== null;
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    localStorage.removeItem('bpwi-last-sync');
    navigator.serviceWorker?.controller?.postMessage('CLEAR_CACHE');
    if ('caches' in window) {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
    }
    if (!isConfigured) return;
    const sb = supabaseBrowser();
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset');
        setErr('');
        setInfo('Enter a new password for your account.');
      }
    });
    return () => subscription.unsubscribe();
  }, [isConfigured]);

  const configWarning =
    !isConfigured || urlError === 'missing_config'
      ? 'Sign-in service is currently unavailable. Please contact your administrator.'
      : urlError === 'auth_error'
        ? 'Unable to verify your session. Please sign in again.'
        : urlError === 'oauth_error'
          ? getOAuthErrorMessage(urlReason)
          : '';

  function switchMode(next: 'signin' | 'signup' | 'forgot' | 'reset') {
    setMode(next === 'signup' && !publicSignupEnabled ? 'signin' : next);
    setErr('');
    setInfo('');
  }

  async function signInWithProvider(provider: 'google' | 'facebook') {
    setErr('');
    setInfo('');
    setOauthProvider(provider);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          ...(provider === 'facebook' ? { scopes: 'email public_profile' } : {}),
        },
      });
      if (error) {
        const msg = /provider is not enabled|unsupported provider/i.test(error.message)
          ? getOAuthErrorMessage('provider_disabled', provider)
          : error.message;
        setErr(msg);
        setOauthProvider(null);
      }
    } catch (e: unknown) {
      setErr(getErrorMessage(e, `${provider === 'google' ? 'Google' : 'Facebook'} sign-in failed`));
      setOauthProvider(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');

    if ((mode === 'signup' || mode === 'reset') && password.length < 12) {
      setErr('Password must be at least 12 characters.');
      return;
    }

    if ((mode === 'signup' || mode === 'reset') && password !== confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const sb = supabaseBrowser();
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          setErr(error.message);
          setLoading(false);
          return;
        }
        window.location.href = '/';
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) {
          setErr(error.message);
          setLoading(false);
          return;
        }
        setInfo('Password reset link sent! Check your email inbox.');
        setLoading(false);
      } else if (mode === 'reset') {
        const { error } = await sb.auth.updateUser({ password });
        if (error) {
          setErr(error.message);
          setLoading(false);
          return;
        }
        setInfo('Password updated! Redirecting…');
        window.location.href = '/';
      } else {
        if (!publicSignupEnabled) {
          setErr('Public self sign-up is disabled. Ask an administrator for an account invitation.');
          setLoading(false);
          return;
        }
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
          },
        });
        if (error) {
          setErr(error.message);
          setLoading(false);
          return;
        }
        if (data.session) {
          window.location.href = '/';
          return;
        }
        setInfo('Account created! Check your email to confirm your address, then sign in.');
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        setLoading(false);
      }
    } catch (e: unknown) {
      const fallback =
        mode === 'signin'
          ? 'Sign in failed'
          : mode === 'forgot'
            ? 'Could not send reset email'
            : mode === 'reset'
              ? 'Could not update password'
              : 'Sign up failed';
      setErr(getErrorMessage(e, fallback));
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="/bpwi-logo.svg"
            alt="BP Waterworks, Inc."
            style={{ width: 56, height: 42, objectFit: 'contain', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              BP Waterworks, Inc.
            </div>
            <h1 style={{ fontSize: 19.5, fontWeight: 800, letterSpacing: '-0.025em', margin: '2px 0 0', color: 'var(--text)' }}>Plant Operations Schedule</h1>
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          {mode === 'signin'
            ? 'Sign in to view or manage the monthly roster.'
            : mode === 'signup'
              ? 'Create an account to get started.'
              : mode === 'forgot'
                ? 'Enter your email address to receive a password reset link.'
                : 'Choose a new password for your account.'}
        </p>

        {(mode === 'signin' || mode === 'signup') ? (
          publicSignupEnabled ? (
            <SegmentedTabs
              ariaLabel="Authentication mode"
              fullWidth
              value={mode}
              onChange={switchMode}
              items={[
                { id: 'signin', label: 'Sign in' },
                { id: 'signup', label: 'Sign up' },
              ]}
              className="login-mode-tabs"
            />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Invite-only access: contact a BP Waterworks administrator for an account.
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={() => switchMode('signin')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              marginBottom: 14,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--accent)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            ← Back to Sign in
          </button>
        )}

        {configWarning && (
          <div style={{ marginBottom: 14 }}>
            <AlertBanner tone="danger">
              <div>{configWarning}</div>
              {(!isConfigured || urlError === 'missing_config') && (
                <details style={{ marginTop: 6, fontSize: 11.5, color: 'var(--danger-fg)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Administrator setup details</summary>
                  <div style={{ marginTop: 4 }}>
                    Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (or{' '}
                    <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) in Vercel / <code>.env.local</code>, then redeploy.
                  </div>
                </details>
              )}
            </AlertBanner>
          </div>
        )}

        {info && (
          <div style={{ marginBottom: 14 }}>
            <AlertBanner tone="ok">{info}</AlertBanner>
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          {mode === 'signup' && (
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
              Full name
              <input
                className="input"
                type="text"
                placeholder="Juan Dela Cruz"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
                disabled={loading}
              />
            </label>
          )}
          {mode !== 'reset' && (
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
              Email
              <input
                className="input"
                type="email"
                placeholder="operator@bpwaterworks.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </label>
          )}
          {mode !== 'forgot' && (
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{mode === 'reset' ? 'New password' : 'Password'}</span>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--accent)',
                      cursor: 'pointer',
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </span>
              <input
                className="input"
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={mode === 'signup' || mode === 'reset' ? 12 : 6}
                required
                disabled={loading}
              />
              {(mode === 'signup' || mode === 'reset') && (
                <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-muted)' }}>
                  Minimum 12 characters.
                </span>
              )}
            </label>
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
              Confirm password
              <input
                className="input"
                type="password"
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
                disabled={loading}
              />
            </label>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || oauthLoading || !isConfigured}
            style={{ padding: '9px 14px', marginTop: 4 }}
          >
            {loading
              ? mode === 'signin'
                ? 'Signing in…'
                : mode === 'forgot'
                  ? 'Sending link…'
                  : mode === 'reset'
                    ? 'Updating password…'
                    : 'Creating account…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : mode === 'reset'
                    ? 'Update password'
                    : 'Create account'}
          </button>
          {(mode === 'signin' || mode === 'signup') && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  margin: '4px 0 2px',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span>or</span>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => signInWithProvider('google')}
                  disabled={loading || oauthLoading || !isConfigured}
                  style={{
                    width: '100%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    background: '#ffffff',
                    borderColor: '#dadce0',
                    color: '#1f1f1f',
                    fontWeight: 600,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  {oauthProvider === 'google'
                    ? 'Redirecting to Google…'
                    : mode === 'signup'
                      ? 'Sign up with Google'
                      : 'Continue with Google'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => signInWithProvider('facebook')}
                  disabled={loading || oauthLoading || !isConfigured}
                  style={{
                    width: '100%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    background: '#1877F2',
                    borderColor: '#1877F2',
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z" />
                  </svg>
                  {oauthProvider === 'facebook'
                    ? 'Redirecting to Facebook…'
                    : mode === 'signup'
                      ? 'Sign up with Facebook'
                      : 'Continue with Facebook'}
                </button>
              </div>
            </>
          )}
          {err && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>
              {err}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
