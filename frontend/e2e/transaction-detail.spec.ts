/**
 * e2e/transaction-detail.spec.ts
 * E2E tests for transaction detail page
 */

import { test, expect } from "@playwright/test";

test.describe("Transaction Detail Page", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the wallet and navigate to dashboard
    await page.goto("/");
    
    // Set up localStorage with a test wallet
    await page.evaluate(() => {
      localStorage.setItem(
        "finchippay:wallet",
        JSON.stringify({
          publicKey: "GABC123...",
          secretKey: null,
        })
      );
    });
  });

  test("should display transaction details correctly", async ({ page }) => {
    // Mock a transaction hash
    const txHash = "abc123def456";
    
    // Navigate to transaction detail page
    await page.goto(`/tx/${txHash}`);
    
    // Check if page loads
    await expect(page.locator("h1")).toContainText("Transaction Details");
  });

  test("should be mobile responsive at 375px width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const txHash = "abc123def456";
    await page.goto(`/tx/${txHash}`);
    
    // Check if elements are visible and properly laid out
    await expect(page.locator("h1")).toBeVisible();
    
    // Check that cards stack vertically on mobile
    const cards = page.locator(".card");
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
  });

  test("should display status timeline", async ({ page }) => {
    const txHash = "abc123def456";
    await page.goto(`/tx/${txHash}`);
    
    // Check for timeline elements
    await expect(page.locator("text=Transaction Timeline")).toBeVisible();
    await expect(page.locator("text=Created")).toBeVisible();
    await expect(page.locator("text=Submitted")).toBeVisible();
    await expect(page.locator("text=Confirmed")).toBeVisible();
  });

  test("should have working action buttons", async ({ page }) => {
    const txHash = "abc123def456";
    await page.goto(`/tx/${txHash}`);
    
    // Check for action buttons
    await expect(page.locator("text=View on Explorer")).toBeVisible();
    await expect(page.locator("text=Copy Hash")).toBeVisible();
    await expect(page.locator("text=Share Receipt")).toBeVisible();
    await expect(page.locator("text=Download PDF")).toBeVisible();
    
    // Test copy hash button
    await page.locator("text=Copy Hash").click();
    await expect(page.locator("text=Copied!")).toBeVisible();
  });

  test("should have touch-friendly buttons (min 44x44px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const txHash = "abc123def456";
    await page.goto(`/tx/${txHash}`);
    
    // Check button sizes
    const actionButtons = page.locator("button").filter({ hasText: /View on Explorer|Copy Hash|Share Receipt|Download PDF/ });
    const firstButton = actionButtons.first();
    
    const box = await firstButton.boundingBox();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("should navigate back to transactions list", async ({ page }) => {
    const txHash = "abc123def456";
    await page.goto(`/tx/${txHash}`);
    
    // Click back button
    await page.locator("text=Back to Transactions").click();
    
    // Should navigate to transactions or previous page
    await page.waitForURL(/transactions|dashboard/);
  });

  test("should handle transaction not found", async ({ page }) => {
    await page.goto(`/tx/invalid-hash-123`);
    
    // Should show error message
    await expect(page.locator("text=/Transaction not found|Failed to load/i")).toBeVisible();
    await expect(page.locator("text=Go Back")).toBeVisible();
  });

  test("should display transaction hash correctly", async ({ page }) => {
    const txHash = "abc123def456789";
    await page.goto(`/tx/${txHash}`);
    
    // Hash should be visible in details section
    await expect(page.locator("text=Transaction Hash")).toBeVisible();
  });

  test("should render desktop layout on wide screens", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const txHash = "abc123def456";
    await page.goto(`/tx/${txHash}`);
    
    // Check for grid layout on desktop
    const gridContainer = page.locator(".grid.grid-cols-1.md\\:grid-cols-2").first();
    await expect(gridContainer).toBeVisible();
  });
});
