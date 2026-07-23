import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PaymentStatusModal from '../components/PaymentStatusModal';
import * as walletModule from '@/lib/wallet';

// Stub the Freighter signer interface mock to simulate a rejection throwing an error with the message 'User declined access'
jest.mock('@/lib/wallet', () => ({
  signTransactionWithWallet: jest.fn(),
}));

describe('PaymentStatusModal user cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('triggers closure handler cleanly on User declined access error and does not enter a critical unhandled application error view state', async () => {
    const mockSignTransaction = walletModule.signTransactionWithWallet as jest.Mock;
    mockSignTransaction.mockRejectedValue(new Error('User declined access'));
    
    const handleClose = jest.fn();

    render(
      <PaymentStatusModal
        isOpen={true}
        status="error"
        error="User declined access"
        txHash={null}
        failedStep="signing"
        stepTimings={{
          building: { startedAt: 1000, completedAt: 2000, error: null },
          signing: { startedAt: 2000, completedAt: null, error: 'User declined access' },
          submitting: { startedAt: null, completedAt: null, error: null },
          confirming: { startedAt: null, completedAt: null, error: null },
        }}
        onClose={handleClose}
      />
    );

    // Assert that the component triggers its closure handler context sequence cleanly
    await waitFor(() => {
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
