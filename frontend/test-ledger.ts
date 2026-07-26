/**
 * Simple test script to verify Ledger implementation
 * Run this in browser console on the WalletConnect page
 */

export {};

interface LedgerPublicKeyResult {
  publicKey: string;
}

interface LedgerSignResult {
  signedXDR: string;
}

declare global {
  interface Window {
    isLedgerSupported?: () => Promise<boolean>;
    getLedgerPublicKey?: () => Promise<LedgerPublicKeyResult>;
    signTransactionWithLedger?: (xdr: string) => Promise<LedgerSignResult>;
    testLedger?: {
      runAllTests: () => Promise<void>;
      testSupport: () => Promise<boolean>;
      testPublicKey: () => Promise<LedgerPublicKeyResult | null>;
      testSigning: () => Promise<LedgerSignResult | null>;
    };
  }
}

// Test 1: Check if Ledger is supported
async function testLedgerSupport(): Promise<boolean> {
  console.log('Testing Ledger support...');
  try {
    const supported = await window.isLedgerSupported?.();
    console.log('Ledger supported:', supported);
    return supported ?? false;
  } catch (error) {
    console.error('Error checking Ledger support:', error);
    return false;
  }
}

// Test 2: Get public key from Ledger
async function testLedgerPublicKey(): Promise<LedgerPublicKeyResult | null> {
  console.log('Testing Ledger public key retrieval...');
  try {
    const result = await window.getLedgerPublicKey?.();
    console.log('Public key result:', result);
    return result ?? null;
  } catch (error) {
    console.error('Error getting public key:', error);
    return null;
  }
}

// Test 3: Test transaction signing (requires a valid XDR)
async function testLedgerSigning(): Promise<LedgerSignResult | null> {
  console.log('Testing Ledger transaction signing...');
  try {
    // This is a sample transaction XDR - replace with actual transaction
    const sampleXDR = 'AAAAAgAAAAAABDAAM2E+PavLo4v8yPEVHukKhQWmrMLxq7Xo3m1GxXEAAADQAK/+AAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAPN1sL+Ir9zjX1qGv3LwQFrRNjbfTmFpLjP8x+Xy8WZgAAAABAAAAAFAAAAAFkb3VibGluZwAAAAAA';
    const result = await window.signTransactionWithLedger?.(sampleXDR);
    console.log('Signing result:', result);
    return result ?? null;
  } catch (error) {
    console.error('Error signing transaction:', error);
    return null;
  }
}

// Run all tests
async function runLedgerTests(): Promise<void> {
  console.log('=== Ledger Implementation Tests ===');

  const supported = await testLedgerSupport();
  if (!supported) {
    console.log('❌ Ledger not supported - skipping remaining tests');
    return;
  }

  console.log('✅ Ledger supported - proceeding with tests');

  const publicKey = await testLedgerPublicKey();
  if (publicKey?.publicKey) {
    console.log('✅ Public key retrieved successfully');
  } else {
    console.log('❌ Failed to get public key');
  }

  // Only test signing if we have a public key
  if (publicKey?.publicKey) {
    const signed = await testLedgerSigning();
    if (signed?.signedXDR) {
      console.log('✅ Transaction signing successful');
    } else {
      console.log('❌ Transaction signing failed');
    }
  }

  console.log('=== Test Complete ===');
}

// Export for use in browser console
window.testLedger = {
  runAllTests: runLedgerTests,
  testSupport: testLedgerSupport,
  testPublicKey: testLedgerPublicKey,
  testSigning: testLedgerSigning,
};

console.log('Ledger test functions loaded. Use window.testLedger.runAllTests() to test.');
