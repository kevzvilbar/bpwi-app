'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getSupabaseEnv } from '@/lib/supabase/env';

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get('error');
  const { isConfigured } = getSupabaseEnv();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const configWarning =
    !isConfigured || urlError === 'missing_config'
      ? 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in your environment variables.'
      : urlError === 'auth_error'
        ? 'Unable to verify your session. Please sign in again.'
        : '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }
      window.location.href = '/';
    } catch (e: any) {
      setErr(e?.message ?? 'Sign in failed');
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
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            BP Waterworks, Inc.
          </div>
          <h1 style={{ fontSize: 20, margin: '4px 0 0', color: '#0f172a' }}>Plant Operations Schedule</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Sign in to view or manage the monthly roster.</p>
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

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
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
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={loading || !isConfigured} style={{ padding: '9px 14px', marginTop: 4 }}>
            {loading ? 'Signing in…' : 'Sign in'}
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
