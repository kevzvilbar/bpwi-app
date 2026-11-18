'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getSupabaseEnv } from '@/lib/supabase/env';

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get('error');
  const { isConfigured } = getSupabaseEnv();

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
    setMode(next);
    setErr('');
    setInfo('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');

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
    } catch (e: any) {
      setErr(
        e?.message ??
          (mode === 'signin'
            ? 'Sign in failed'
            : mode === 'forgot'
              ? 'Could not send reset email'
              : mode === 'reset'
                ? 'Could not update password'
                : 'Sign up failed'),
      );
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 28,
          borderRadius: 12,
          boxShadow: '0 4px 20px rgba(15, 23, 42, 0.12)',
        }}
      >
        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="/bpwi-logo.svg"
            alt="BP Waterworks, Inc."
            style={{ width: 56, height: 42, objectFit: 'contain', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              BP Waterworks, Inc.
            </div>
            <h1 style={{ fontSize: 19, margin: '2px 0 0', color: 'var(--text)' }}>Plant Operations Schedule</h1>
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
              padding: 4,
              marginBottom: 16,
              background: 'var(--surface-muted)',
              borderRadius: 8,
            }}
          >
            <button
              type="button"
              onClick={() => switchMode('signin')}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === 'signin' ? 'var(--surface)' : 'transparent',
                color: mode === 'signin' ? 'var(--text)' : 'var(--text-secondary)',
                boxShadow: mode === 'signin' ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === 'signup' ? 'var(--surface)' : 'transparent',
                color: mode === 'signup' ? 'var(--text)' : 'var(--text-secondary)',
                boxShadow: mode === 'signup' ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
              }}
            >
              Sign up
            </button>
          </div>
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
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                marginBottom: 14,
                borderRadius: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              <div>{configWarning}</div>
              {(!isConfigured || urlError === 'missing_config') && (
                <details style={{ marginTop: 6, fontSize: 11.5, color: '#7f1d1d' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Administrator setup details</summary>
                  <div style={{ marginTop: 4 }}>
                    Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (or{' '}
                    <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) in Vercel / <code>.env.local</code>, then redeploy.
                  </div>
                </details>
              )}
            </div>
          )}

        {info && (
          <div
            role="status"
            style={{
              padding: '10px 12px',
              marginBottom: 14,
              borderRadius: 8,
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#166534',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {info}
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
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6}
                required
                disabled={loading}
              />
            </label>
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
              Confirm password
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
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
            <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: 0 }}>
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
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748b' }}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
