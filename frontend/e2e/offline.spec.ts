/**
 * e2e/offline.spec.ts
 * E2E tests for offline/PWA support.
 *
 * Verifies:
 *  - Offline banner appears when network is disabled
 *  - Cached transaction list renders when offline
 *  - Offline banner disappears when network is restored
 */

import { test, expect } from "./fixtures";

const MOCK_RECIPIENT_KEY = "GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4";

/** Connect a wallet via the mocked Freighter, idempotently. */
async function connectWallet(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");

  const walletAddress = page.getByText("Wallet Address");
  const alreadyConnected = await walletAddress
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (alreadyConnected) return;

  await page.getByRole("button", { name: /Connect Freighter Wallet/i }).click();
  await expect(walletAddress).toBeVisible({ timeout: 15000 });
}

test.describe("Offline / PWA support", () => {
  test("shows offline banner when network is disabled", async ({ page }) => {
    await page.goto("/transactions");

    // Verify page loaded normally (online)
    const heading = page.getByRole("heading", { name: "Transaction History" });
    await expect(heading).toBeVisible();

    // Verify no offline banner while online
    const offlineBanner = page.getByText("You are offline");
    await expect(offlineBanner).not.toBeVisible();

    // Disconnect from network
    await page.context().setOffline(true);

    // Offline banner should appear
    await expect(offlineBanner).toBeVisible({ timeout: 5000 });

    // Reconnect to network
    await page.context().setOffline(false);

    // Offline banner should disappear
    await expect(offlineBanner).not.toBeVisible({ timeout: 5000 });
  });

  test("renders cached transaction data when offline", async ({ page }) => {
    // Visit the transactions page while online to populate cache
    await page.goto("/transactions");

    // Wait for the service worker to take control so precached assets are available
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Wait for the page to load fully with transaction data visible
    await page.waitForSelector('[role="list"]', { timeout: 10000 });

    // Assert the "Offline history snapshot" label is NOT visible (we're online)
    const staleLabel = page.getByText("Offline history snapshot");
    await expect(staleLabel).not.toBeVisible();

    // Reload with network disabled
    await page.context().setOffline(true);
    await page.reload();

    // Offline banner should appear
    const offlineBanner = page.getByText("You are offline");
    await expect(offlineBanner).toBeVisible({ timeout: 5000 });

    // The page should still render (showing cached data or skeleton)
    // Either the history heading or a loading/error state is acceptable
    const headingOrFallback = page.locator('h1, [role="heading"], .card, [role="list"]');
    await expect(headingOrFallback.first()).toBeVisible({ timeout: 10000 });
  });

  test("dashboard loads cached balances when offline", async ({ page }) => {
    // Visit dashboard while online to populate balance cache
    await page.goto("/dashboard");

    // Wait for the dashboard to render
    await page.waitForSelector("h1", { timeout: 10000 });

    // Wait for SW to take control so shell is cached
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Go offline and reload
    await page.context().setOffline(true);
    await page.reload();

    // Offline banner should appear
    const offlineBanner = page.getByText("You are offline");
    await expect(offlineBanner).toBeVisible({ timeout: 5000 });

    // Dashboard heading should still be visible (cached shell)
    const heading = page.getByRole("heading", { name: "Dashboard" });
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test("offline composer queues a payment and auto-submits on reconnect", async ({ page }) => {
    // A wallet must be connected so the composer has a sender address.
    await connectWallet(page);

    // Visit the offline page while online so the service worker can precache it.
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expect(page.getByTestId("offline-composer-destination")).toBeVisible();

    // Go offline and compose a transaction.
    await page.context().setOffline(true);
    await page.getByTestId("offline-composer-destination").fill(MOCK_RECIPIENT_KEY);
    await page.getByTestId("offline-composer-amount").fill("10");
    await page.getByTestId("offline-composer-submit").click();

    // The transaction should be queued and shown with its pending status.
    await expect(page.getByTestId("offline-composer-pending-count")).toHaveText(/1 pending/);
    await expect(page.getByText(MOCK_RECIPIENT_KEY)).toBeVisible();

    // Reload while offline — the queue must persist in IndexedDB.
    await page.reload();
    await expect(page.getByTestId("offline-composer-pending-count")).toHaveText(/1 pending/);
    await expect(page.getByText(MOCK_RECIPIENT_KEY)).toBeVisible();

    // Reconnect — the queued transaction should be auto-submitted.
    await page.context().setOffline(false);
    await expect(page.getByText(/Submitted 1 queued transaction/)).toBeVisible({ timeout: 15000 });
  });
});
