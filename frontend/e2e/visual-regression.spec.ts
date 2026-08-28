/**
 * Visual regression tests using Playwright screenshot comparison.
 *
 * Each core page is tested at both desktop and mobile viewports via
 * the `chromium` and `mobile-chrome` projects defined in playwright.config.ts.
 *
 * Animations are disabled to prevent flaky diffs. Baseline screenshots are
 * generated on the first run and committed to the repo. Subsequent runs
 * compare against these baselines and fail if the pixel diff exceeds 1%.
 *
 * To update baselines after an intentional layout change:
 *   npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 */
import { test as base, expect } from '@playwright/test';
import { test as authenticatedTest } from './fixtures';

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

async function disableAnimations(page: import('@playwright/test').Page) {
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
}

// ── Landing page ─────────────────────────────────────────────────────────────

base.describe('visual regression — landing page', () => {
  base.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: async () => ({ isConnected: false }),
        getAddress: async () => ({ address: '' }),
        getPublicKey: async () => ({ publicKey: '' }),
        signTransaction: async () => ({ signedTxXdr: '' }),
        requestAccess: async () => ({}),
        isAllowed: async () => ({ isAllowed: false }),
      };
    });
  });

  base('landing page full viewport', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await disableAnimations(page);
    await expect(page).toHaveScreenshot('landing-page.png', { fullPage: true });
  });
});

// ── Dashboard (unauthenticated) ──────────────────────────────────────────────

base.describe('visual regression — dashboard (unauthenticated)', () => {
  base.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: async () => ({ isConnected: false }),
        getPublicKey: async () => ({ publicKey: '' }),
        signTransaction: async () => ({ signedTransaction: '' }),
        requestAccess: async () => ({}),
        isAllowed: async () => ({ isAllowed: false }),
      };
    });
  });

  base('dashboard unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await disableAnimations(page);
    await expect(page).toHaveScreenshot('dashboard-unauthenticated.png', { fullPage: true });
  });
});

// ── Dashboard (authenticated) ────────────────────────────────────────────────

authenticatedTest.describe('visual regression — dashboard (authenticated)', () => {
  authenticatedTest('dashboard authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();
    await page.locator('p.label').filter({ hasText: 'Wallet Address' }).waitFor({ timeout: 15_000 });
    await disableAnimations(page);
    await expect(page).toHaveScreenshot('dashboard-authenticated.png', { fullPage: true });
  });
});

// ── Send Payment form ────────────────────────────────────────────────────────

authenticatedTest.describe('visual regression — send payment', () => {
  authenticatedTest('send payment form with amounts filled', async ({ page }) => {
    await page.goto('/pay');
    await page.waitForLoadState('networkidle');
    await disableAnimations(page);

    const recipientInput = page.getByLabel(/recipient/i);
    const amountInput = page.getByLabel(/amount/i);

    if (await recipientInput.isVisible().catch(() => false)) {
      await recipientInput.fill('GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4');
    }
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill('25.5');
    }

    await expect(page).toHaveScreenshot('send-payment-filled.png', { fullPage: true });
  });
});

// ── Escrow page ──────────────────────────────────────────────────────────────

authenticatedTest.describe('visual regression — escrow', () => {
  authenticatedTest('escrow page with form', async ({ page }) => {
    await page.route('**/soroban-testnet.stellar.org/**', async route => {
      const postData = route.request().postDataJSON();
      const method = postData?.method;
      const reqId = postData?.id ?? 1;

      if (method === 'getLatestLedger') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            result: { sequence: 1000 },
          }),
        });
      }

      if (method === 'simulateTransaction') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            result: {
              latestLedger: 1000,
              minResourceFee: '100',
              results: [{ auth: [], xdr: 'AAAAAQAAAAE=' }],
            },
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: reqId, result: {} }),
      });
    });

    await page.goto('/escrow');
    await page.waitForLoadState('networkidle');
    await disableAnimations(page);
    await expect(page).toHaveScreenshot('escrow-page.png', { fullPage: true });
  });
});

// ── Transaction list ─────────────────────────────────────────────────────────

authenticatedTest.describe('visual regression — transactions', () => {
  authenticatedTest('transaction list page', async ({ page }) => {
    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    await disableAnimations(page);
    await expect(page).toHaveScreenshot('transactions-page.png', { fullPage: true });
  });
});

// ── Portfolio page ───────────────────────────────────────────────────────────

authenticatedTest.describe('visual regression — portfolio', () => {
  authenticatedTest.beforeEach(async ({ page }) => {
    await page.route('**/api/features', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ features: { new_portfolio: true } }),
      });
    });
    await page.route('**/api/v1/tokens/*/price-history*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contractId: 'mock',
          range: '30d',
          prices: [
            { timestamp: Date.now() - 86_400_000, price: 0.095 },
            { timestamp: Date.now(), price: 0.1 },
          ],
        }),
      });
    });
  });

  authenticatedTest('portfolio page', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    await disableAnimations(page);
    await expect(page).toHaveScreenshot('portfolio-page.png', { fullPage: true });
  });
});
