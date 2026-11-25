import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../../app/manifest.ts';
import { detectInstallPlatform, shouldShowInstallBanner } from '../pwa-install.ts';

describe('PWA installability & manifest', () => {
  it('provides full standalone manifest metadata with any and maskable icons', () => {
    const m = manifest();
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/');
    assert.equal(m.scope, '/');
    const icons = m.icons ?? [];
    assert.ok(icons.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
    assert.ok(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
    assert.ok(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    assert.ok((m.shortcuts ?? []).length >= 2);
  });

  it('detects mobile and standalone install platforms accurately', () => {
    assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14)', true), 'installed');
    assert.equal(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', false), 'ios');
    assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', false), 'android');
    assert.equal(detectInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false), 'desktop');
  });

  it('respects standalone state, 7-day dismissal window, and prompt availability', () => {
    const now = Date.UTC(2026, 10, 25, 0, 0, 0);
    assert.equal(
      shouldShowInstallBanner({ isStandalone: true, dismissedUntilMs: null, nowMs: now, hasDeferredPrompt: true, platform: 'android' }),
      false,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: now + 60_000, nowMs: now, hasDeferredPrompt: true, platform: 'android' }),
      false,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: now - 1, nowMs: now, hasDeferredPrompt: true, platform: 'android' }),
      true,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: null, nowMs: now, hasDeferredPrompt: false, platform: 'ios' }),
      true,
    );
    assert.equal(
      shouldShowInstallBanner({ isStandalone: false, dismissedUntilMs: null, nowMs: now, hasDeferredPrompt: false, platform: 'desktop' }),
      false,
    );
  });
});
