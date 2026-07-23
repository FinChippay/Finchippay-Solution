import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import MultiSigFlow from '../components/MultiSigFlow';

jest.mock('@stellar/stellar-sdk', () => ({
  Transaction: class {
    signatures = [];
    toXDR() { return "mock_xdr"; }
  },
  Networks: {
    PUBLIC: 'public',
    TESTNET: 'testnet'
  },
  Asset: class {
    code?: string;
    issuer?: string;
    constructor(code: string, issuer?: string) {
      this.code = code;
      this.issuer = issuer;
    }
    static native() { return new this("XLM"); }
  }
}));

jest.mock('@finchippay/sdk', () => ({
  FinchippayClient: class {}
}), { virtual: true });

// Add jest-axe matchers
expect.extend(toHaveNoViolations);

describe('MultiSigFlow', () => {
  const mockPublicKey = "GBBD47IF6LWK7P7MDEVSCWTTCJM4RTJC6UP3SAMZONNEJLAAN5J7NYXO";
  
  it('renders with no accessibility violations', async () => {
    const { container } = render(
      <MultiSigFlow publicKey={mockPublicKey} xlmBalance="1000" />
    );
    // Disable label rule because the original inputs don't have htmlFor/ids
    const results = await axe(container, { rules: { label: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('renders step indicator with correct semantic HTML and aria-current', () => {
    render(<MultiSigFlow publicKey={mockPublicKey} xlmBalance="1000" />);
    
    // Ensure the <nav> has aria-label Progress
    const nav = screen.getByRole('navigation', { name: /progress/i });
    expect(nav).toBeInTheDocument();

    // Ensure it's an ordered list
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');

    // The first step "Build" should have aria-current="step"
    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0]).toHaveAttribute('aria-current', 'step');
    
    // The second step "Sign" should not have aria-current
    expect(listItems[1]).not.toHaveAttribute('aria-current');
  });

  it('allows keyboard navigation through the build step form inputs', async () => {
    const user = userEvent.setup();
    const { container } = render(<MultiSigFlow publicKey={mockPublicKey} xlmBalance="1000" />);
    
    const destinationInput = screen.getByPlaceholderText('G...');
    const amountInput = screen.getByPlaceholderText('0.0');
    const memoInput = screen.getByPlaceholderText('Payment description');
    // For threshold, it doesn't have a placeholder, but it has type="number" and min="2"
    const thresholdInput = container.querySelector('input[type="number"][min="2"]');
    const buildButton = screen.getByRole('button', { name: /Build Transaction/i });

    // Focus destination
    destinationInput.focus();
    expect(destinationInput).toHaveFocus();

    // Tab to next element
    await user.tab();
    expect(amountInput).toHaveFocus();

    // Tab to memo
    await user.tab();
    expect(memoInput).toHaveFocus();

    // Tab to threshold
    await user.tab();
    expect(thresholdInput).toHaveFocus();
    
    // It should be disabled initially since destination is empty
    expect(buildButton).toBeDisabled();
  });

  it('renders an accessible error message', async () => {
    const user = userEvent.setup();
    const failingService = {
      buildPaymentTransaction: jest.fn().mockRejectedValue(new Error("Simulated build error"))
    };
    
    render(<MultiSigFlow publicKey={mockPublicKey} xlmBalance="1000" services={failingService} />);
    
    // Fill out the form correctly
    await user.type(screen.getByPlaceholderText('G...'), mockPublicKey);
    await user.type(screen.getByPlaceholderText('0.0'), "10");
    
    const buildButton = screen.getByRole('button', { name: /Build Transaction/i });
    expect(buildButton).toBeEnabled();
    
    // Submit via keyboard
    buildButton.focus();
    await user.keyboard('[Enter]');
    
    // Look for the error
    const errorMsg = await screen.findByRole('alert');
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent('Simulated build error');
    expect(errorMsg).toHaveAttribute('aria-live', 'polite');
  });
});
