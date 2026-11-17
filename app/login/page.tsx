'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getSupabaseEnv } from '@/lib/supabase/env';

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get('error');
  const { isConfigured } = getSupabaseEnv();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const configWarning =
    !isConfigured || urlError === 'missing_config'
      ? 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in your environment variables.'
      : urlError === 'auth_error'
        ? 'Unable to verify your session. Please sign in again.'
        : '';

  function switchMode(next: 'signin' | 'signup') {
    setMode(next);
    setErr('');
    setInfo('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');

    if (mode === 'signup' && password !== confirmPassword) {
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
      setErr(e?.message ?? (mode === 'signin' ? 'Sign in failed' : 'Sign up failed'));
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 28,
          background: '#ffffff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 23, 42, 0.08)',
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            BP Waterworks, Inc.
          </div>
          <h1 style={{ fontSize: 20, margin: '4px 0 0', color: '#0f172a' }}>Plant Operations Schedule</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            {mode === 'signin' ? 'Sign in to view or manage the monthly roster.' : 'Create an account to get started.'}
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            padding: 4,
            marginBottom: 16,
            background: '#f1f5f9',
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
              background: mode === 'signin' ? '#ffffff' : 'transparent',
              color: mode === 'signin' ? '#0f172a' : '#64748b',
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
              background: mode === 'signup' ? '#ffffff' : 'transparent',
              color: mode === 'signup' ? '#0f172a' : '#64748b',
              boxShadow: mode === 'signup' ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
            }}
          >
            Sign up
          </button>
        </div>

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
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {configWarning}
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
          <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
            Password
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
          {mode === 'signup' && (
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
            {loading ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          {err && (
            <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: 0 }}>
              {err}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748b' }}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
