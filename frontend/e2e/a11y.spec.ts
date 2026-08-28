import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.describe('Accessibility & Color Contrast Audits', () => {
  const pagesToTest = ['/', '/dashboard', '/transactions', '/portfolio', '/escrow'];

  for (const path of pagesToTest) {
    test(`Page ${path} passes WCAG AA color-contrast rules in Light mode`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark', 'high-contrast');
      });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'cat.color'])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test(`Page ${path} passes WCAG AA color-contrast rules in Dark mode`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('high-contrast');
      });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'cat.color'])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test(`Page ${path} passes WCAG color-contrast rules in High Contrast mode`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => {
        document.documentElement.classList.add('high-contrast');
      });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'cat.color'])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }
});
