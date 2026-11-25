import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPhotoCacheHeaders,
  hasSupabaseAuthCookie,
  isSampleStoragePath,
} from '../photo-proxy.ts';

describe('photo-proxy helpers', () => {
  const realPath = '11111111-1111-4111-8111-111111111111/2026-11-25/1795500000000-ab12cd.webp';
  const samplePath = '11111111-1111-4111-8111-111111111111/2026-11-25/sample-1795500000000-ab12cd.webp';

  describe('isSampleStoragePath', () => {
    it('detects sample- filename prefixes case-insensitively', () => {
      assert.equal(isSampleStoragePath(samplePath), true);
      assert.equal(
        isSampleStoragePath('11111111-1111-4111-8111-111111111111/2026-11-25/SAMPLE-photo.jpg'),
        true,
      );
      assert.equal(isSampleStoragePath('Sample-direct.png'), true);
    });

    it('returns false for real photo paths and sample- in non-filename segments', () => {
      assert.equal(isSampleStoragePath(realPath), false);
      assert.equal(isSampleStoragePath('sample-org/2026-11-25/real-photo.webp'), false);
      assert.equal(
        isSampleStoragePath('11111111-1111-4111-8111-111111111111/2026-11-25/mysample-photo.webp'),
        false,
      );
      assert.equal(isSampleStoragePath(''), false);
      assert.equal(isSampleStoragePath('   '), false);
    });
  });

  describe('buildPhotoCacheHeaders', () => {
    it('returns short revalidating private cache headers and deterministic ETag for real photos', () => {
      const first = buildPhotoCacheHeaders(realPath, false);
      const second = buildPhotoCacheHeaders(realPath, false);

      assert.equal(first.cacheable, true);
      assert.equal(first.etag, second.etag);
      assert.ok(first.etag.includes(Buffer.from(realPath, 'utf8').toString('base64url')));
      assert.equal(first.headers['Cache-Control'], 'private, max-age=300, must-revalidate');
      assert.equal(first.headers.ETag, first.etag);
      assert.equal(first.headers.Vary, 'Cookie');
      assert.equal(first.headers['Cache-Control'].includes('immutable'), false);
      assert.equal(first.headers['Cache-Control'].includes('86400'), false);
    });

    it('disables caching when isSample flag is true', () => {
      const res = buildPhotoCacheHeaders(realPath, true);

      assert.equal(res.cacheable, false);
      assert.equal(res.etag, '');
      assert.deepEqual(res.headers, {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      });
    });

    it('disables caching when storage path has sample- filename prefix even if isSample is false', () => {
      const res = buildPhotoCacheHeaders(samplePath, false);

      assert.equal(res.cacheable, false);
      assert.equal(res.etag, '');
      assert.deepEqual(res.headers, {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      });
    });
  });

  describe('hasSupabaseAuthCookie', () => {
    it('returns true for Supabase SSR and legacy auth cookies', () => {
      assert.equal(hasSupabaseAuthCookie(['sb-projref-auth-token']), true);
      assert.equal(hasSupabaseAuthCookie(['theme', 'sb-projref-auth-token.0', 'sb-projref-auth-token.1']), true);
      assert.equal(hasSupabaseAuthCookie(['SB-ABC123-AUTH-TOKEN']), true);
      assert.equal(hasSupabaseAuthCookie(['supabase-auth-token']), true);
      assert.equal(hasSupabaseAuthCookie(['SUPABASE-AUTH-TOKEN']), true);
    });

    it('returns false when no Supabase auth cookie is present', () => {
      assert.equal(hasSupabaseAuthCookie([]), false);
      assert.equal(hasSupabaseAuthCookie(['theme', 'sidebar_state', 'csrf_token']), false);
      assert.equal(hasSupabaseAuthCookie(['sb-projref-other']), false);
      assert.equal(hasSupabaseAuthCookie(['not-supabase-auth-token']), false);
    });
  });

  describe('photo proxy route static security & caching checks', () => {
    const routePath = path.resolve(process.cwd(), 'app/api/activities/photo/route.ts');
    const routeSrc = fs.readFileSync(routePath, 'utf8');

    it('verifies row-level RLS visibility on daily_activities before serving or 304', () => {
      const rlsIndex = routeSrc.indexOf("from('daily_activities')");
      const notModifiedIndex = routeSrc.indexOf('status: 304');
      assert.ok(rlsIndex !== -1, 'route must query daily_activities for RLS visibility');
      assert.ok(routeSrc.includes("contains('photo_storage_paths'"), 'route must check photo_storage_paths');
      assert.ok(routeSrc.includes("contains('photo_urls'"), 'route must fall back to legacy photo_urls');
      assert.ok(notModifiedIndex !== -1 && rlsIndex < notModifiedIndex, 'RLS check must run before 304 check');
    });

    it('uses buildPhotoCacheHeaders and never emits immutable or 86400s cache headers', () => {
      assert.ok(routeSrc.includes('buildPhotoCacheHeaders('), 'route must delegate cache headers to buildPhotoCacheHeaders');
      assert.equal(routeSrc.toLowerCase().includes('immutable'), false, 'route must never emit immutable');
      assert.equal(routeSrc.includes('86400'), false, 'route must not use 86400s max-age');
      assert.ok(routeSrc.includes('if (cacheable'), 'route must gate 304 responses on cacheable');
    });
  });
});
