/**
 * E2E tests for the token portfolio dashboard (issue #362).
 *
 * The page is gated behind the "new_portfolio" feature flag (0% rollout by
 * default — issue #103), so every test here mocks GET /api/features to force
 * it on, independent of the real backend's rollout config.
 *
 * Scenarios:
 *  1. Portfolio shows the "Connect wallet" prompt when no wallet is connected.
 *  2. After mock-connecting Freighter, the overview/allocation/price-chart
 *     sections render with real (mocked) holdings and price data.
 *  3. Adding an invalid contract ID shows a validation error.
 *  4. Adding a valid contract ID adds it to the holdings list.
 */
import { test as base, expect } from '@playwright/test';
import { test as authenticatedTest } from './fixtures';

/**
 * Dismiss Next.js dev mode's error-overlay portal, if present.
 *
 * This app has a pre-existing, app-wide hydration warning (also hit by
 * wallet-connect.spec.ts) that renders a full-viewport `<nextjs-portal>`
 * overlay in dev mode. It doesn't affect production builds, but its portal
 * intercepts pointer events in `next dev`, so tests must close it before
 * interacting with real page content.
 */
async function dismissDevErrorOverlay(page: import('@playwright/test').Page) {
  const closeButton = page.locator('nextjs-portal').getByRole('button', { name: 'Close' });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

/**
 * Click a locator, retrying a few times if the dev error overlay (see
 * `dismissDevErrorOverlay`) re-appears and intercepts the click — it can be
 * re-triggered by a re-render right as the click fires.
 */
async function clickDismissingOverlay(page: import('@playwright/test').Page, locator: ReturnType<import('@playwright/test').Page['getByRole']>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissDevErrorOverlay(page);
    try {
      await locator.click({ timeout: 3_000 });
      return;
    } catch {
      // Overlay likely re-appeared mid-click — dismiss and retry.
    }
  }
  await dismissDevErrorOverlay(page);
  await locator.click();
}

async function mockPortfolioBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/features', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ features: { new_portfolio: true } }),
    });
  });

  await page.route('**/api/v1/tokens/*/price-history*', (route) => {
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
}

// ── Scenario 1: no wallet connected ──────────────────────────────────────────

base.describe('portfolio — wallet not connected', () => {
  base.beforeEach(async ({ page }) => {
    await mockPortfolioBackend(page);
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

  base.test('shows Connect wallet prompt when no wallet is connected', async ({ page }) => {
    await page.goto('/portfolio');

    await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
    await expect(page.getByText('Connect your wallet to get started')).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect Freighter Wallet/i })).toBeVisible();
  });
});

// ── Scenarios 2-4: Freighter mock-connected ──────────────────────────────────
// Uses the shared `authenticatedTest` fixture (100 XLM balance, mocked Horizon/
// Soroban/CoinGecko/auth) so holdings and prices are deterministic.

authenticatedTest.describe('portfolio — wallet connected', () => {
  authenticatedTest.beforeEach(async ({ page }) => {
    await mockPortfolioBackend(page);
  });

  authenticatedTest(
    'shows total value, allocation, and a price chart after connecting',
    async ({ page }) => {
      // The `authenticatedTest` fixture's mocked Freighter auto-restores the
      // session on mount — no manual "Connect" click needed on this page.
      await page.goto('/portfolio');

      await expect(page.getByText('Total Value')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Allocation')).toBeVisible();
      await expect(page.getByText(/Price History/)).toBeVisible();
      await expect(page.getByText(/XLM/).first()).toBeVisible();
    },
  );

  authenticatedTest('rejects an invalid contract ID in Add Token', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Total Value')).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('Contract ID (C...)').fill('not-a-contract-id');
    await clickDismissingOverlay(page, page.getByRole('button', { name: 'Add', exact: true }));

    await expect(
      page.getByText("That doesn't look like a valid Soroban contract ID."),
    ).toBeVisible();
  });

  authenticatedTest('adds a custom token by a well-formed contract ID', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Total Value')).toBeVisible({ timeout: 15_000 });

    const contractId = `C${'A'.repeat(55)}`;
    await page.getByPlaceholder('Contract ID (C...)').fill(contractId);
    await clickDismissingOverlay(page, page.getByRole('button', { name: 'Add', exact: true }));

    // The custom token has no known price, so it renders truncated
    // (shortenAddress) with a "Price unavailable" placeholder rather than a
    // fiat value — confirms it was actually added to holdings.
    await expect(page.getByText('Price unavailable')).toBeVisible();
  });
});
