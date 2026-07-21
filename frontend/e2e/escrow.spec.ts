// frontend/e2e/escrow.spec.ts
import { test, expect } from './fixtures';
import { nativeToScVal } from '@stellar/stellar-sdk';

const SENDER_PUBLIC_KEY = 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV';
const RECIPIENT_PUBLIC_KEY = 'GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4';

function buildEscrowScValBase64({
  id = 1,
  from = SENDER_PUBLIC_KEY,
  to = RECIPIENT_PUBLIC_KEY,
  token = 'CDLZFC3SYJYDVR7P6JC4D723W55OHCH2EPCM4LD2V7NBCH7S2AFTIS2Z',
  amount = BigInt(100000000),
  release_ledger = 1500,
  status = 'Pending',
} = {}) {
  const scVal = nativeToScVal({
    id,
    from,
    to,
    token,
    amount,
    release_ledger,
    status,
  });
  return scVal.toXDR('base64');
}

async function connectWallet(page: any) {
  await page.goto('/escrow');
  const createHeading = page.getByRole('heading', { name: /Create escrow/i });
  const alreadyConnected = await createHeading
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (!alreadyConnected) {
    await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();
    await expect(createHeading).toBeVisible({ timeout: 15000 });
  }
}

test.describe('Escrow E2E Flow', () => {
  test('Create escrow: fill form, submit, verify confirmation, and lookup active escrow', async ({
    page,
  }) => {
    // Setup Soroban RPC response for lookup after creation
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
        const scValBase64 = buildEscrowScValBase64({
          id: 1,
          from: SENDER_PUBLIC_KEY,
          to: RECIPIENT_PUBLIC_KEY,
          amount: BigInt(100000000),
          release_ledger: 1500,
          status: 'Pending',
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            result: {
              latestLedger: 1000,
              minResourceFee: '100',
              results: [
                {
                  auth: [],
                  xdr: scValBase64,
                  retval: scValBase64,
                },
              ],
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

    await connectWallet(page);

    // Fill in create escrow form
    await page.getByLabel(/Recipient address/i).fill(RECIPIENT_PUBLIC_KEY);
    await page.getByLabel(/Amount \(XLM\)/i).fill('10');
    await page.getByLabel(/Release ledger/i).fill('1500');

    const submitBtn = page.getByRole('button', { name: /Lock funds in escrow/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Assert confirmation message
    await expect(
      page.getByText(/Escrow created\. Note the id from the transaction return value/i),
    ).toBeVisible();

    // Look up created escrow in manage section
    const lookupInput = page.getByPlaceholder('Escrow id');
    await lookupInput.fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Assert escrow appears in lookup result with active state
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText('100000000 stroops')).toBeVisible();
    await expect(page.getByText('1,500')).toBeVisible();
  });

  test('Claim escrow: recipient claims funds after release ledger has elapsed', async ({
    page,
  }) => {
    let currentStatus = 'Pending';

    await page.route('**/soroban-testnet.stellar.org/**', async route => {
      const postData = route.request().postDataJSON();
      const method = postData?.method;
      const reqId = postData?.id ?? 1;

      if (method === 'getLatestLedger') {
        // Advance current ledger past release ledger (2000 > 1500)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            result: { sequence: 2000 },
          }),
        });
      }

      if (method === 'simulateTransaction') {
        const scValBase64 = buildEscrowScValBase64({
          id: 1,
          from: RECIPIENT_PUBLIC_KEY,
          to: SENDER_PUBLIC_KEY, // connected wallet is recipient
          amount: BigInt(100000000),
          release_ledger: 1500,
          status: currentStatus,
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            result: {
              latestLedger: 2000,
              minResourceFee: '100',
              results: [
                {
                  auth: [],
                  xdr: scValBase64,
                  retval: scValBase64,
                },
              ],
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

    await connectWallet(page);

    // Look up escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Verify claim button is enabled
    const claimBtn = page.getByRole('button', { name: 'Claim', exact: true });
    await expect(claimBtn).toBeEnabled();

    // Perform claim
    currentStatus = 'Released';
    await claimBtn.click();

    // Verify lookup updates
    await expect(page.getByText('Released', { exact: true })).toBeVisible();
  });

  test('Cancel escrow: sender cancels funds before release ledger has elapsed', async ({
    page,
  }) => {
    let currentStatus = 'Pending';

    await page.route('**/soroban-testnet.stellar.org/**', async route => {
      const postData = route.request().postDataJSON();
      const method = postData?.method;
      const reqId = postData?.id ?? 1;

      if (method === 'getLatestLedger') {
        // Ledger is before release ledger (1000 < 1500)
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
        const scValBase64 = buildEscrowScValBase64({
          id: 1,
          from: SENDER_PUBLIC_KEY, // connected wallet is sender
          to: RECIPIENT_PUBLIC_KEY,
          amount: BigInt(100000000),
          release_ledger: 1500,
          status: currentStatus,
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            result: {
              latestLedger: 1000,
              minResourceFee: '100',
              results: [
                {
                  auth: [],
                  xdr: scValBase64,
                  retval: scValBase64,
                },
              ],
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

    await connectWallet(page);

    // Look up escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Verify cancel button is enabled
    const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancelBtn).toBeEnabled();

    // Perform cancel
    currentStatus = 'Cancelled';
    await cancelBtn.click();

    // Verify lookup updates
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  });

  test('Validation errors: empty amount, past release date, self-transfer', async ({
    page,
  }) => {
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

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: reqId, result: {} }),
      });
    });

    await connectWallet(page);

    const submitBtn = page.getByRole('button', { name: /Lock funds in escrow/i });

    // 1. Self-transfer validation error
    await page.getByLabel(/Recipient address/i).fill(SENDER_PUBLIC_KEY);
    await page.getByLabel(/Amount \(XLM\)/i).fill('10');
    await page.getByLabel(/Release ledger/i).fill('1500');
    await expect(page.getByText('Self-transfer is not allowed.')).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    // 2. Past release date validation error
    await page.getByLabel(/Recipient address/i).fill(RECIPIENT_PUBLIC_KEY);
    await page.getByLabel(/Release ledger/i).fill('500'); // current ledger is 1000
    await expect(
      page.getByText('Release ledger must be greater than current ledger.'),
    ).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    // 3. Invalid / empty amount validation error
    await page.getByLabel(/Release ledger/i).fill('1500');
    await page.getByLabel(/Amount \(XLM\)/i).fill('0');
    await expect(page.getByText('Amount must be a positive number.')).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });
});
