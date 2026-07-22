// frontend/e2e/escrow.spec.ts
import { test, expect } from './fixtures';
import { nativeToScVal } from '@stellar/stellar-sdk';

const SENDER_PUBLIC_KEY = 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV';
const RECIPIENT_PUBLIC_KEY = 'GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const XLM_CONTRACT_ID = 'CDLZFC3SYJYDVR7P6JC4D723W55OHCH2EPCM4LD2V7NBCH7S2AFTIS2Z';

function buildEscrowScValBase64({
  id = 1,
  from = SENDER_PUBLIC_KEY,
  to = RECIPIENT_PUBLIC_KEY,
  token = XLM_CONTRACT_ID,
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

  test('Attempt claim before release shows disabled claim button with tooltip', async ({
    page,
  }) => {
    // Mock RPC: current ledger (1000) is before release ledger (1500).
    // The escrow `to` is SENDER_PUBLIC_KEY (connected wallet), so the
    // connected wallet IS the escrow recipient.
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
          from: RECIPIENT_PUBLIC_KEY,
          to: SENDER_PUBLIC_KEY, // connected wallet IS the escrow recipient
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

    // Connect as default wallet (sender in fixtures). The mock escrow has
    // `to: SENDER_PUBLIC_KEY`, so the connected user is the escrow recipient.
    await connectWallet(page);

    // Look up escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Verify the claim button is disabled because release ledger is in the future
    const claimBtn = page.getByRole('button', { name: 'Claim', exact: true });
    await expect(claimBtn).toBeDisabled();
    await expect(claimBtn).toHaveAttribute('title', 'Release ledger not reached');

    // Also verify the partial claim button is disabled for the same reason
    const partialClaimBtn = page.getByRole('button', { name: 'Partial claim' });
    await expect(partialClaimBtn).toBeDisabled();
  });

  test('Attempt cancel after release shows disabled cancel button with tooltip', async ({
    page,
  }) => {
    // Mock RPC: current ledger (2000) is after release ledger (1500)
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
            result: { sequence: 2000 },
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

    // Connect as sender — current ledger 2000 > release ledger 1500
    await connectWallet(page);

    // Look up escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Verify the cancel button is disabled with correct tooltip
    const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancelBtn).toBeDisabled();
    await expect(cancelBtn).toHaveAttribute('title', 'Release ledger already reached');

    // Claim should be disabled too (connected wallet is sender, not recipient)
    const claimBtn = page.getByRole('button', { name: 'Claim', exact: true });
    await expect(claimBtn).toBeDisabled();
    await expect(claimBtn).toHaveAttribute('title', 'Only the recipient can claim');
  });

  test('Partial claim reduces remaining balance after release', async ({
    page,
  }) => {
    // Escrow starts with 100000000 stroops (10 XLM) — recipient is the connected
    // wallet (SENDER_PUBLIC_KEY). After release, claim 3 XLM and verify the
    // remaining balance is updated to 70000000 stroops (7 XLM).
    let currentEscrowAmount = BigInt(100000000);
    let currentStatus = 'Pending';

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
            result: { sequence: 2000 },
          }),
        });
      }

      if (method === 'simulateTransaction') {
        // Detect if this is the partial claim call by checking the contract method
        const args = postData?.params?.args;
        const isPartialClaim =
          args &&
          Array.isArray(args) &&
          args.length > 0 &&
          typeof args[0] === 'object' &&
          (args[0]?.method === 'claim_escrow_partial' ||
           (args[0]?.args &&
            args[0].args[0]?.method === 'claim_escrow_partial'));

        if (isPartialClaim) {
          // After partial claim, remaining = 100000000 - 30000000 = 70000000
          currentEscrowAmount = BigInt(70000000);
          const remainingScVal = nativeToScVal(currentEscrowAmount, { type: 'i128' });
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
                    xdr: remainingScVal.toXDR('base64'),
                    retval: remainingScVal.toXDR('base64'),
                  },
                ],
              },
            }),
          });
        }

        const scValBase64 = buildEscrowScValBase64({
          id: 1,
          from: RECIPIENT_PUBLIC_KEY,
          to: SENDER_PUBLIC_KEY, // connected wallet is the escrow recipient
          amount: currentEscrowAmount,
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

    // Connect as default wallet — the mock escrow has `to: SENDER_PUBLIC_KEY`,
    // so the connected user IS the escrow recipient.
    await connectWallet(page);

    // Look up escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Verify initial balance of 100000000 stroops
    await expect(page.getByText('100000000 stroops')).toBeVisible();

    // Since release ledger (1500) has passed (current 2000), claim buttons should be enabled
    const claimBtn = page.getByRole('button', { name: 'Claim', exact: true });
    await expect(claimBtn).toBeEnabled();
    const partialClaimBtn = page.getByRole('button', { name: 'Partial claim' });

    // Enter partial claim amount (3 XLM = 30000000 stroops)
    const partialClaimInput = page.getByPlaceholder('Partial amount (XLM)');
    await expect(partialClaimInput).toBeVisible();
    await partialClaimInput.fill('3');

    // Partial claim button should become enabled after entering a positive amount
    await expect(partialClaimBtn).toBeEnabled();

    // Perform the partial claim
    await partialClaimBtn.click();

    // After the partial claim, the lookup refreshes and shows reduced balance
    await expect(page.getByText('70000000 stroops')).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  });

  test('Escrow with USDC asset works correctly', async ({
    page,
  }) => {
    const USDC_CONTRACT_ID = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7';

    // Override Horizon mock to include USDC trustline
    await page.route('**/horizon-testnet.stellar.org/accounts/**', async route => {
      const url = route.request().url();
      if (url.includes('/accounts/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: SENDER_PUBLIC_KEY,
            account_id: SENDER_PUBLIC_KEY,
            sequence: '1234567890',
            subentry_count: 1,
            thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
            flags: { auth_required: false, auth_revocable: false },
            signers: [{ key: SENDER_PUBLIC_KEY, weight: 1, type: 'ed25519_public_key' }],
            balances: [
              { asset_type: 'native', balance: '100.0000000' },
              {
                asset_type: 'credit_alphanum4',
                asset_code: 'USDC',
                asset_issuer: USDC_ISSUER,
                balance: '500.0000000',
              },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, body: '{}' });
    });

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
        // Return an escrow with USDC token
        const usdcScVal = buildEscrowScValBase64({
          id: 2,
          from: SENDER_PUBLIC_KEY,
          to: RECIPIENT_PUBLIC_KEY,
          token: USDC_CONTRACT_ID,
          amount: BigInt(50000000), // 50 USDC (6 decimals)
          release_ledger: 2000,
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
                  xdr: usdcScVal,
                  retval: usdcScVal,
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

    // Look up a USDC escrow
    await page.getByPlaceholder('Escrow id').fill('2');
    await page.getByRole('button', { name: 'Look up' }).click();

    // Verify escrow details display with USDC
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText('50000000 stroops')).toBeVisible();
    await expect(page.getByText('2,000')).toBeVisible(); // release ledger
  });

  test('Escrow details page shows correct metadata for found escrow', async ({
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
            result: { sequence: 1200 },
          }),
        });
      }

      if (method === 'simulateTransaction') {
        const scValBase64 = buildEscrowScValBase64({
          id: 1,
          from: SENDER_PUBLIC_KEY,
          to: RECIPIENT_PUBLIC_KEY,
          amount: BigInt(250000000),
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
              latestLedger: 1200,
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

    // Verify all metadata fields are displayed
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText('250000000 stroops')).toBeVisible();
    await expect(page.getByText('1,500')).toBeVisible(); // release ledger
    await expect(page.getByText('1,200')).toBeVisible(); // current ledger

    // Verify the sender and recipient addresses are shown
    await expect(page.getByText(SENDER_PUBLIC_KEY)).toBeVisible();
    await expect(page.getByText(RECIPIENT_PUBLIC_KEY)).toBeVisible();

    // Verify structured labels exist
    await expect(page.getByText('Status')).toBeVisible();
    await expect(page.getByText('From')).toBeVisible();
    await expect(page.getByText('To')).toBeVisible();
    await expect(page.getByText('Amount')).toBeVisible();
    await expect(page.getByText('Release ledger')).toBeVisible();
    await expect(page.getByText('Current ledger')).toBeVisible();

    // Verify action buttons are present
    await expect(page.getByRole('button', { name: 'Claim', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Partial claim' })).toBeVisible();
  });
});
