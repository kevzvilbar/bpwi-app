import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface WebAppManifest {
  icons?: ManifestIcon[];
}

// 1x1 transparent PNG bytes for synthetic evidence upload during offline workflow tests.
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const allowMutations = process.env.E2E_ALLOW_MUTATIONS === 'true';
const operatorEmail = process.env.E2E_OPERATOR_EMAIL ?? '';
const operatorPassword = process.env.E2E_OPERATOR_PASSWORD ?? '';
const managerEmail = process.env.E2E_MANAGER_EMAIL ?? '';
const managerPassword = process.env.E2E_MANAGER_PASSWORD ?? '';
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? '';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';

const hasOfflineWorkflowEnv = Boolean(
  allowMutations && operatorEmail && operatorPassword && adminEmail && adminPassword,
);
const hasProposalWorkflowEnv = Boolean(
  allowMutations && managerEmail && managerPassword && adminEmail && adminPassword,
);

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

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

test.describe('BPWI Workflow & PWA Integrity E2E', () => {
  test('PWA manifest icons resolve as valid images and service worker script exposes /field allowlist without CSP errors', async ({ page, request }) => {
    const { pageErrors, cspErrors } = attachBrowserErrorListeners(page);

    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);
    const manifest = (await manifestRes.json()) as WebAppManifest;
    const icons = manifest.icons ?? [];
    expect(icons.length).toBeGreaterThan(0);

    for (const icon of icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status(), `Manifest icon ${icon.src} should return 200`).toBe(200);
      expect(iconRes.headers()['content-type'] ?? '').toMatch(/^image\//i);
    }

    const swRes = await request.get('/sw.js');
    expect(swRes.status()).toBe(200);
    const swBody = await swRes.text();
    expect(swBody).toMatch(/bpwi-ops-v\d+/);
    expect(swBody).toMatch(/OFFLINE_PAGE_ALLOWLIST\s*=\s*new Set\(\['\/field'\]\)/);

    await page.goto('/login');
    const hasServiceWorkerApi = await page.evaluate(() => typeof navigator.serviceWorker !== 'undefined');
    expect(hasServiceWorkerApi).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(cspErrors).toEqual([]);
  });

  test('operator logs activity + photo offline on /field, reconnects to sync, and admin verifies and holds evidence on /activities', async ({ browser }) => {
    test.skip(
      !hasOfflineWorkflowEnv,
      'Set E2E_ALLOW_MUTATIONS=true, E2E_OPERATOR_EMAIL/PASSWORD, and E2E_ADMIN_EMAIL/PASSWORD to run authenticated offline workflow tests',
    );

    const tag = `E2E-${Date.now()}`;
    const noteText = `[${tag}] offline pump inspection`;

    const opContext = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 14.5995, longitude: 120.9842, accuracy: 2 },
    });
    const opPage = await opContext.newPage();
    const opErrors = attachBrowserErrorListeners(opPage);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminErrors = attachBrowserErrorListeners(adminPage);

    try {
      await signIn(opPage, operatorEmail, operatorPassword);
      await opPage.goto('/field');

      const logBtn = opPage.getByRole('button', { name: '+ Log Activity' });
      await expect(logBtn).toBeVisible({ timeout: 20_000 });

      await opContext.setOffline(true);
      await expect(opPage.getByText(/Offline Mode:/i)).toBeVisible({ timeout: 10_000 });

      await logBtn.click();
      const dialog = opPage.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByRole('button', { name: /Attach GPS/i }).click();
      await expect(dialog.getByText(/GPS ±/i)).toBeVisible({ timeout: 10_000 });

      await dialog.locator('input[type="file"]').setInputFiles({
        name: `${tag}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(SAMPLE_PNG_BASE64, 'base64'),
      });
      await expect(dialog.getByRole('img', { name: /Field attachment 1/i })).toBeVisible({ timeout: 10_000 });

      await dialog.getByLabel(/Field Notes \/ Observations/i).fill(noteText);
      await dialog.getByRole('button', { name: 'Submit Activity Log' }).click();

      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await expect(opPage.getByText(/1 waiting/i)).toBeVisible({ timeout: 10_000 });

      await opContext.setOffline(false);
      await expect(opPage.getByText(/Synced 1 queued item/i)).toBeVisible({ timeout: 25_000 });

      await signIn(adminPage, adminEmail, adminPassword);
      await adminPage.goto('/activities');

      const card = adminPage.locator('.card').filter({ hasText: noteText }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });

      await card.getByRole('button', { name: /Verify/i }).click();
      await expect(card.getByText(/Verified/i)).toBeVisible({ timeout: 15_000 });

      await card.getByRole('button', { name: 'Hold Photos' }).click();
      await expect(card.getByRole('button', { name: 'Release Hold' })).toBeVisible({ timeout: 15_000 });

      expect(opErrors.pageErrors).toEqual([]);
      expect(opErrors.cspErrors).toEqual([]);
      expect(adminErrors.pageErrors).toEqual([]);
      expect(adminErrors.cspErrors).toEqual([]);
    } finally {
      try {
        if (!adminPage.isClosed()) {
          const cleanupCard = adminPage.locator('.card').filter({ hasText: noteText }).first();
          if (await cleanupCard.isVisible().catch(() => false)) {
            await cleanupCard.getByRole('button', { name: 'Delete' }).click();
            await adminPage.getByRole('button', { name: 'Delete log' }).click();
          }
        }
      } catch {
        // Best-effort cleanup in staging environments.
      }
      await opContext.close();
      await adminContext.close();
    }
  });

  test('department head proposes a roster change on / and admin reviews and rejects cleanup proposal on /requests', async ({ browser }) => {
    test.skip(
      !hasProposalWorkflowEnv,
      'Set E2E_ALLOW_MUTATIONS=true, E2E_MANAGER_EMAIL/PASSWORD, and E2E_ADMIN_EMAIL/PASSWORD to run proposal/approval workflow tests',
    );

    const tag = `E2E-REQ-${Date.now()}`;
    const mgrContext = await browser.newContext();
    const mgrPage = await mgrContext.newPage();
    const mgrErrors = attachBrowserErrorListeners(mgrPage);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminErrors = attachBrowserErrorListeners(adminPage);

    let proposalSubmitted = false;
    try {
      await signIn(mgrPage, managerEmail, managerPassword);
      await mgrPage.goto('/');

      const grid = mgrPage.getByRole('grid');
      await expect(grid).toBeVisible({ timeout: 20_000 });

      // Queue one brush/tap edit in propose mode if editable cells exist in the staging org.
      const firstCell = mgrPage.locator('td[data-rc="0-0"]');
      if (await firstCell.isVisible().catch(() => false)) {
        await firstCell.click();
        const submitForApprovalBtn = mgrPage.getByRole('button', { name: 'Submit for Approval' });
        if (await submitForApprovalBtn.isVisible().catch(() => false)) {
          await submitForApprovalBtn.click();
          await mgrPage.locator('#submit-note-input').fill(tag);
          await mgrPage.getByRole('button', { name: /Submit \d+ Change/i }).click();
          await expect(mgrPage.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
          proposalSubmitted = true;
        }
      }

      await mgrPage.goto('/requests');
      await expect(mgrPage.getByRole('tab', { name: /Pending/i })).toBeVisible({ timeout: 15_000 });

      await signIn(adminPage, adminEmail, adminPassword);
      await adminPage.goto('/requests');
      await expect(adminPage.getByRole('tab', { name: /Pending/i })).toBeVisible({ timeout: 15_000 });

      if (proposalSubmitted) {
        const reqCard = adminPage.locator('.card').filter({ hasText: tag }).first();
        await expect(reqCard).toBeVisible({ timeout: 15_000 });
        await reqCard.getByRole('button', { name: /Reject (?:all|remaining)/i }).click();
        const rejectDialog = adminPage.getByRole('dialog');
        await rejectDialog.getByLabel('Reason for rejection').fill('E2E cleanup');
        await rejectDialog.getByRole('button', { name: 'Confirm rejection' }).click();
        await expect(rejectDialog).toBeHidden({ timeout: 15_000 });
      }

      expect(mgrErrors.pageErrors).toEqual([]);
      expect(mgrErrors.cspErrors).toEqual([]);
      expect(adminErrors.pageErrors).toEqual([]);
      expect(adminErrors.cspErrors).toEqual([]);
    } finally {
      await mgrContext.close();
      await adminContext.close();
    }
  });
});
