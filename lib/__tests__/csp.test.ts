import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCspHeader, extractOrigin, generateCspNonce } from '../csp.ts';
import { shouldBypassSessionAuth } from '../middleware-rules.ts';

describe('CSP header & nonce helpers', () => {
  it('generates distinct base64 nonces', () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    assert.ok(a.length >= 16);
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9+/=]+$/);
  });

  it('extracts origins safely from URLs and tile templates including {s} subdomain placeholders', () => {
    assert.equal(extractOrigin('https://xyzcompany.supabase.co/rest/v1'), 'https://xyzcompany.supabase.co');
    assert.equal(extractOrigin('https://tiles.example.com/{z}/{x}/{y}.png'), 'https://tiles.example.com');
    assert.equal(extractOrigin('https://{s}.tile.example.com/{z}/{x}/{y}.png'), 'https://*.tile.example.com');
    assert.equal(extractOrigin('https://{s}.tile.example.com:8443/{z}/{x}/{y}.png'), 'https://*.tile.example.com:8443');
    assert.equal(extractOrigin('javascript:alert(1)'), null);
    assert.equal(extractOrigin(''), null);
  });

  it('builds a strict nonce CSP with report-uri and without script unsafe-inline or wildcard https/wss in production', () => {
    const csp = buildCspHeader({
      nonce: 'abc123nonce',
      isDev: false,
      supabaseUrl: 'https://demo.supabase.co',
    });

    assert.ok(csp.includes("script-src 'self' 'nonce-abc123nonce' 'strict-dynamic'"));
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.ok(!csp.includes("'unsafe-eval'"));
    assert.ok(csp.includes("connect-src 'self' https://demo.supabase.co wss://demo.supabase.co"));
    assert.ok(!csp.includes("connect-src 'self' https: wss:"));
    assert.ok(csp.includes('https://demo.supabase.co'));
    assert.ok(csp.includes('https://tiles.openfreemap.org'));
    assert.ok(csp.includes('https://server.arcgisonline.com'));
    assert.ok(!csp.includes('tile.openstreetmap.org'));
    assert.ok(csp.includes('report-uri /api/csp-report'));
  });

  it('uses custom {s} tile server origins instead of default OpenFreeMap/Esri when configured', () => {
    const csp = buildCspHeader({
      nonce: 'n1',
      isDev: true,
      supabaseUrl: 'https://demo.supabase.co',
      streetTileUrl: 'https://{s}.street.internal.org/tiles/{z}/{x}/{y}.png',
      satelliteTileUrl: 'https://sat.internal.org/tiles/{z}/{x}/{y}.png',
    });

    assert.ok(csp.includes("'unsafe-eval'"));
    assert.ok(csp.includes('https://*.street.internal.org'));
    assert.ok(csp.includes('https://sat.internal.org'));
    assert.ok(!csp.includes('tiles.openfreemap.org'));
    assert.ok(!csp.includes('tile.openstreetmap.org'));
    assert.ok(!csp.includes('server.arcgisonline.com'));
  });

  it('allows POST /api/csp-report to bypass session auth while keeping GET blocked', () => {
    assert.equal(shouldBypassSessionAuth('/api/csp-report', 'POST'), true);
    assert.equal(shouldBypassSessionAuth('/api/csp-report', 'GET'), false);
  });
});
