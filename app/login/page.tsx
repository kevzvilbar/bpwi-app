'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { getErrorMessage } from '@/lib/error-utils';
import { AlertBanner, SegmentedTabs } from '@/components/ui';

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get('error');
  const { isConfigured } = getSupabaseEnv();
  const publicSignupEnabled = process.env.NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP !== 'false';

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
        : '';

  function switchMode(next: 'signin' | 'signup' | 'forgot' | 'reset') {
    setMode(next === 'signup' && !publicSignupEnabled ? 'signin' : next);
    setErr('');
    setInfo('');
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
        setInfo('Account created! Check your email if confirmation is required — an administrator will match your name on the employee list and approve your access.');
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
          <Image
            src="/bpwi-logo.svg"
            alt="BP Waterworks, Inc."
            width={56}
            height={42}
            unoptimized
            style={{ objectFit: 'contain', flexShrink: 0 }}
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
            ? 'Sign in to manage schedules, field activity logs, maintenance, and job orders.'
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
              minHeight: 38,
              padding: '6px 4px',
              display: 'inline-flex',
              alignItems: 'center',
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
              <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-muted)' }}>
                Enter your full name as listed on the employee roster so an admin can validate and approve your account.
              </span>
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
                    className="btn-link"
                    onClick={() => switchMode('forgot')}
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
            disabled={loading || !isConfigured}
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
          {err && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>
              {err}
            </p>
          )}
        </form>
        <p style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 0 }}>
          Internal BP Waterworks, Inc. operations platform. Account details, shift/activity logs, and the GPS location of field activity logs are processed for utility dispatch and audit under the Data Privacy Act (RA 10173). Field photos expire after 30 days (180 days for meter tests and leak repairs, up to 365 days when held).
        </p>
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
