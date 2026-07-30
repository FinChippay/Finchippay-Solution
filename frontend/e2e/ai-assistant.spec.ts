// playwright/e2e/ai-assistant.spec.ts
import { test, expect } from './fixtures';

const MOCK_PUBLIC_KEY = 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV';

/**
 * Walks through the full AI Payment Assistant flow:
 *   1. Open the assistant modal via the floating button.
 *   2. Type a natural-language payment description.
 *   3. Submit and verify the parsed result appears.
 *   4. Confirm the parsed intent fills the payment form.
 */
test('AI payment assistant: parse natural language and fill form', async ({ page }) => {
  // Mock the backend /api/v1/parse-payment endpoint
  await page.route('**/api/v1/parse-payment', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.input?.includes('75 XLM')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          amount: '75 XLM',
          recipient: MOCK_PUBLIC_KEY,
          memo: 'logo design',
          isValid: true,
          clarification: '',
        }),
      });
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          amount: '',
          recipient: 'Alice',
          memo: 'job',
          isValid: false,
          clarification: 'What amount should be sent?',
        }),
      });
    }
  });
  // Navigate to dashboard — the fixture already mocks Freighter + Horizon
  await page.goto('/dashboard');

  // Wait for the authenticated dashboard to render
  await expect(page.getByText('Wallet Address')).toBeVisible({ timeout: 15000 });

  // Open the AI assistant via the floating button
  const assistantButton = page.getByRole('button', { name: 'Open AI Payment Assistant' });
  await expect(assistantButton).toBeVisible();
  await assistantButton.click();

  // The modal should appear with a heading and textarea
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('AI Payment Assistant')).toBeVisible();

  // Type a payment description
  const textarea = dialog.getByRole('textbox', { name: 'Payment description' });
  await textarea.fill('Send 75 XLM to GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV for logo design');

  // Click parse
  await dialog.getByRole('button', { name: 'Parse Payment' }).click();

  // The parsed result should appear with the extracted details
  await expect(dialog.getByText('Parsed Payment Details')).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByText('75 XLM')).toBeVisible();
  await expect(dialog.getByText(MOCK_PUBLIC_KEY)).toBeVisible();

  // Confirm — the parsed data should populate the send form
  await dialog.getByRole('button', { name: 'Fill Payment Form' }).click();

  // The modal should close
  await expect(dialog).not.toBeVisible();

  // The send form should now contain the parsed values
  const destinationInput = page.getByPlaceholder('G..., alice*domain.com, or @username');
  await expect(destinationInput).toHaveValue(MOCK_PUBLIC_KEY);

  const amountInput = page.getByRole('spinbutton');
  await expect(amountInput).toHaveValue('75');
});

test('AI payment assistant: shows clarification when input is ambiguous', async ({ page }) => {
  // Mock parse-payment to return ambiguous result
  await page.route('**/api/v1/parse-payment', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amount: '',
        recipient: 'Alice',
        memo: 'job',
        isValid: false,
        clarification: 'What amount should be sent?',
      }),
    });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Wallet Address')).toBeVisible({ timeout: 15000 });

  // Open the AI assistant
  await page.getByRole('button', { name: 'Open AI Payment Assistant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Type an ambiguous request (no amount)
  await dialog.getByRole('textbox', { name: 'Payment description' }).fill('Pay Alice for the job');

  // Click parse
  await dialog.getByRole('button', { name: 'Parse Payment' }).click();

  // Should show "Need More Information" with a clarification question
  await expect(dialog.getByText('Need More Information')).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByText(/What amount|missing|clarify/i)).toBeVisible();

  // The "Try Again" button should be visible
  await expect(dialog.getByRole('button', { name: 'Try Again' })).toBeVisible();
});

test('AI payment assistant: can be closed with Escape key', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Wallet Address')).toBeVisible({ timeout: 15000 });

  // Open the AI assistant
  await page.getByRole('button', { name: 'Open AI Payment Assistant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Press Escape
  await page.keyboard.press('Escape');

  // Modal should close
  await expect(dialog).not.toBeVisible();
});
