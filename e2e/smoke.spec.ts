import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface ManifestShortcut {
  name?: string;
  url?: string;
}

interface WebAppManifest {
  display?: string;
  icons?: ManifestIcon[];
  shortcuts?: ManifestShortcut[];
}

function attachBrowserErrorListeners(page: Page): {
  pageErrors: string[];
  cspErrors: string[];
} {
  const pageErrors: string[] = [];
  const cspErrors: string[] = [];

  page.on('pageerror', (err: Error) => {
    pageErrors.push(err.message);
  });

  page.on('console', (msg: ConsoleMessage) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    if (/content[- ]security[- ]policy|violates the following|refused to (?:execute|apply|load)/i.test(text)) {
      cspErrors.push(text);
    }
  });

  return { pageErrors, cspErrors };
}

test.describe('BPWI Smoke Suite', () => {
  test('/login renders BP Waterworks branding, tabs, signup helper text, client password validation, and passes CSP without errors', async ({ page }) => {
    const { pageErrors, cspErrors } = attachBrowserErrorListeners(page);

    const response = await page.goto('/login');
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);

    const cspHeader = response?.headers()['content-security-policy'] ?? '';
    expect(cspHeader).toMatch(/script-src[^;]*'nonce-[^']+'/);

    await expect(page).toHaveTitle(/BP Waterworks/i);
    await expect(page.getByText('BP Waterworks, Inc.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Plant Operations Schedule/i })).toBeVisible();

    // Confirm the nonce-protected theme bootstrap inline script executed cleanly.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme === 'light' || theme === 'dark').toBe(true);

    const signInTab = page.getByRole('tab', { name: 'Sign in' });
    const signUpTab = page.getByRole('tab', { name: 'Sign up' });
    await expect(signInTab).toBeVisible();
    await expect(signUpTab).toBeVisible();
    await expect(signInTab).toHaveAttribute('aria-selected', 'true');

    await signUpTab.click();
    await expect(signUpTab).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByLabel(/Full name/i)).toBeVisible();
    await expect(page.getByText(/as listed on the employee roster/i)).toBeVisible();
    await expect(page.getByText('Minimum 12 characters.')).toBeVisible();

    await page.getByLabel(/Full name/i).fill('Juan Dela Cruz');
    await page.getByLabel(/^Email$/i).fill('operator@bpwaterworks.com');

    const passwordInput = page.getByLabel(/^Password/i);
    const confirmInput = page.getByLabel(/Confirm password/i);
    await expect(passwordInput).toHaveAttribute('minlength', '12');

    await passwordInput.fill('short123');
    await confirmInput.fill('short123');

    const shortState = await passwordInput.evaluate((el) => {
      if (!(el instanceof HTMLInputElement)) {
        return { valid: true, tooShort: false };
      }
      return { valid: el.checkValidity(), tooShort: el.validity.tooShort };
    });
    expect(shortState.valid).toBe(false);
    expect(shortState.tooShort).toBe(true);

    const submitButton = page.getByRole('button', { name: 'Create account' });
    if (await submitButton.isEnabled()) {
      await submitButton.click();
      expect(new URL(page.url()).pathname).toBe('/login');
    }

    await passwordInput.fill('ValidPassphrase123');
    await confirmInput.fill('ValidPassphrase123');

    const validState = await passwordInput.evaluate((el) => {
      if (!(el instanceof HTMLInputElement)) {
        return { valid: false, tooShort: true };
      }
      return { valid: el.checkValidity(), tooShort: el.validity.tooShort };
    });
    expect(validState.valid).toBe(true);
    expect(validState.tooShort).toBe(false);

    expect(pageErrors).toEqual([]);
    expect(cspErrors).toEqual([]);
  });

  test('unauthenticated protected routes redirect to /login and protected APIs reject unauthenticated requests', async ({ page, request }) => {
    const { pageErrors, cspErrors } = attachBrowserErrorListeners(page);
    const protectedRoutes = ['/', '/activities', '/pm', '/requests', '/field', '/mobile'] as const;

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
      expect(new URL(page.url()).pathname).toBe('/login');
    }

    expect(pageErrors).toEqual([]);
    expect(cspErrors).toEqual([]);

    const importRes = await request.post('/api/import', { data: {} });
    expect([401, 503]).toContain(importRes.status());

    const telemetryRes = await request.post('/api/telemetry/client-error', {
      data: { event: 'offline_sync_failed', category: 'network', message: 'offline' },
    });
    expect([401, 503]).toContain(telemetryRes.status());

    const leaveExportRes = await request.get('/api/reports/leave-export');
    expect([401, 503]).toContain(leaveExportRes.status());
  });

  test('/login fits mobile phone viewport cleanly without horizontal overflow', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const { pageErrors, cspErrors } = attachBrowserErrorListeners(page);

    await page.goto('/login');
    await expect(page.getByText(/field activity logs/i)).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    expect(pageErrors).toEqual([]);
    expect(cspErrors).toEqual([]);
    await context.close();
  });

  test('PWA installability endpoints serve valid manifest (/field shortcut) and service worker', async ({ request }) => {
    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);

    const manifest = (await manifestRes.json()) as WebAppManifest;
    expect(manifest.display).toBe('standalone');
    expect(manifest.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Tasks & Logs', url: '/field' }),
      ]),
    );

    const icons = manifest.icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ sizes: '192x192', purpose: 'maskable' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
      ]),
    );

    const swRes = await request.get('/sw.js');
    expect(swRes.status()).toBe(200);
    const swBody = await swRes.text();
    expect(swBody.length).toBeGreaterThan(0);
    expect(swBody).toMatch(/OFFLINE_PAGE_ALLOWLIST\s*=\s*new Set\(\['\/field'\]\)/);
  });
});
