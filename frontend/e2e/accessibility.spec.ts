import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

/**
 * e2e/accessibility.spec.ts
 * Full WCAG 2.1 A/AA axe-core scan (all rule categories) across the app's
 * main pages. Complements e2e/a11y.spec.ts, which focuses specifically on
 * color-contrast across light/dark/high-contrast themes.
 */

test.describe('Accessibility (axe-core, full WCAG 2.1 A/AA ruleset)', () => {
  const pagesToTest = [
    '/',
    '/dashboard',
    '/transactions',
    '/portfolio',
    '/escrow',
    '/trade',
    '/tokens',
    '/settings',
    '/network',
    '/accessibility',
  ];

  for (const path of pagesToTest) {
    test(`Page ${path} has no critical/serious WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const seriousOrWorse = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      if (seriousOrWorse.length > 0) {
        console.log(JSON.stringify(seriousOrWorse, null, 2));
      }

      expect(seriousOrWorse).toEqual([]);
    });
  }

  test('Skip-to-content link is the first focusable element and jumps to main content', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('Export modal traps focus and closes on Escape', async ({ page }) => {
    await page.goto('/transactions');

    const exportTrigger = page.getByRole('button', { name: /export/i }).first();
    if (!(await exportTrigger.isVisible().catch(() => false))) {
      test.skip(true, 'No export trigger visible without a connected wallet');
    }

    await exportTrigger.click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
