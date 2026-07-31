import { test, expect } from "./fixtures";

const INITIATOR_KEY = "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV";
const COSIGNER_KEY = "GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4";

async function connectWallet(page: any) {
  await page.goto("/dashboard");
  const walletAddress = page.getByText("Wallet Address");
  const alreadyConnected = await walletAddress
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (alreadyConnected) return;
  await page.getByRole("button", { name: /Connect/i }).click();
  await expect(page.getByText("Wallet Address")).toBeVisible({ timeout: 10000 });
}

test.describe("Multi-Sig Flow", () => {
  test("2-of-2 multi-sig full flow", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const initiator = await ctx1.newPage();
    const cosigner = await ctx2.newPage();

    await connectWallet(initiator);
    await initiator.goto("/dashboard");
    await initiator.fill('[placeholder*="address" i]', COSIGNER_KEY);
    await initiator.fill('[placeholder*="amount" i]', "200");
    await expect(initiator.getByText(/multi.?sig/i).first()).toBeVisible({ timeout: 5000 });
    await initiator.getByRole("button", { name: /sign/i }).click();
    await expect(initiator.getByText(/signed/i)).toBeVisible({ timeout: 5000 });
    await initiator.getByRole("button", { name: /copy|share/i }).click();
    const shareUrl = await initiator.evaluate(() => navigator.clipboard.readText());
    await cosigner.goto(shareUrl || "/multi-sig-sign");
    await expect(cosigner.getByText(/sign/i)).toBeVisible({ timeout: 5000 });
    await cosigner.getByRole("button", { name: /sign/i }).click();
    await initiator.getByRole("button", { name: /collect|add signature/i }).click();
    await initiator.fill('[placeholder*="signed" i]', "mock_signed_xdr");
    await initiator.getByRole("button", { name: /add|verify/i }).click();
    await initiator.getByRole("button", { name: /submit/i }).click();
    await expect(initiator.getByText(/success|confirmed/i)).toBeVisible({ timeout: 10000 });

    await ctx1.close();
    await ctx2.close();
  });

  test("co-signer page parses XDR from URL", async ({ page }) => {
    await page.goto("/multi-sig-sign?xdr=mock_xdr_base64");
    await expect(page.getByText(/sign/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /sign/i }).click();
    await expect(page.getByText(/signed/i)).toBeVisible({ timeout: 5000 });
  });

  test("invalid XDR pasted shows error", async ({ page }) => {
    await connectWallet(page);
    await page.goto("/dashboard");
    await page.fill('[placeholder*="address" i]', COSIGNER_KEY);
    await page.fill('[placeholder*="amount" i]', "200");
    await expect(page.getByText(/multi.?sig/i).first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /sign/i }).click();
    await page.getByRole("button", { name: /collect|add signature/i }).click();
    await page.fill('[placeholder*="signed" i]', "invalid_xdr!!!");
    await page.getByRole("button", { name: /add|verify/i }).click();
    await expect(page.getByText(/invalid|error/i)).toBeVisible({ timeout: 5000 });
  });

  test("co-signer page with invalid XDR shows error", async ({ page }) => {
    await page.goto("/multi-sig-sign?xdr=invalid!!!");
    await expect(page.getByText(/invalid|error/i)).toBeVisible({ timeout: 5000 });
  });

  test("signature count updates correctly", async ({ page }) => {
    await connectWallet(page);
    await page.goto("/dashboard");
    await page.fill('[placeholder*="address" i]', COSIGNER_KEY);
    await page.fill('[placeholder*="amount" i]', "200");
    await expect(page.getByText(/multi.?sig/i).first()).toBeVisible({ timeout: 5000 });
    await page.fill('[placeholder*="threshold" i]', "3");
    await page.getByRole("button", { name: /sign/i }).click();
    await page.getByRole("button", { name: /collect|add signature/i }).click();
    await page.fill('[placeholder*="signed" i]', "mock_signed_1");
    await page.getByRole("button", { name: /add/i }).click();
    await expect(page.getByText(/1.*of.*3/i)).toBeVisible({ timeout: 5000 });
    await page.fill('[placeholder*="signed" i]', "mock_signed_2");
    await page.getByRole("button", { name: /add/i }).click();
    await expect(page.getByText(/2.*of.*3/i)).toBeVisible({ timeout: 5000 });
  });
});
