/**
 * __tests__/a11y.test.tsx
 * Automated accessibility tests using jest-axe (axe-core).
 *
 * Tests every major page and interactive component for WCAG 2.1 AA violations.
 * Run with: npm test -- --testPathPattern=a11y
 */

import React from "react";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";

// ─── Mock dependencies ──────────────────────────────────────────────────────

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: jest.fn() },
  }),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: jest.fn(() => ({ publicKey: null, connectWallet: jest.fn(), disconnectWallet: jest.fn() })),
}));

jest.mock("@/pages/_app", () => ({
  useTheme: jest.fn(() => ({ theme: "dark", toggleTheme: jest.fn() })),
  ThemeContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}));

// Mock Next.js router and Link for Navbar
jest.mock("next/router", () => ({
  useRouter: jest.fn(() => ({
    pathname: "/",
    asPath: "/",
    query: {},
    push: jest.fn(),
    replace: jest.fn(),
    reload: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
    beforePopState: jest.fn(),
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
    isFallback: false,
  })),
}));

jest.mock("next/link", () => {
  // Using React.forwardRef with an explicit displayName set below
  return ({ children, href, ...props }: Record<string, unknown>) => {
    return <a href={href as string} {...props}>{children}</a>;
  };
});

jest.mock("@/lib/stellar", () => ({
  connectWallet: jest.fn(),
  getNetworkConfig: jest.fn(() => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" })),
  fetchNetworkFeeStats: jest.fn(() => Promise.resolve({ feeLevel: "normal", baseFeeXlm: 0.00001 })),
  shortenAddress: jest.fn((addr) => addr?.slice(0, 6) + "..."),
  isValidStellarAddress: jest.fn((addr) => addr?.startsWith("G") && addr.length === 56),
  isValidFederationAddress: jest.fn(() => false),
  buildPaymentTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  CONTRACT_ID: "CCONTRACT123456789",
  getSorobanRpcUrl: jest.fn(() => "https://soroban-testnet.stellar.org"),
  getSorobanServer: jest.fn(() => ({})),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_STROOPS_PER_XLM: 10_000_000,
  STELLAR_BASE_FEE_STROOPS: 100,
}));

jest.mock("@/lib/wallet", () => ({
  connectWallet: jest.fn(),
  performSEP0010Auth: jest.fn(),
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/lib/ToastContext", () => ({
  useToastContext: jest.fn(() => ({ addToast: jest.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/lib/FeatureFlags", () => ({
  FeatureFlagProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/WalletConnect", () => ({
  __esModule: true,
  default: () => <div data-testid="wallet-connect">WalletConnect</div>,
}));

// ─── Component imports ──────────────────────────────────────────────────────

import Navbar from "@/components/Navbar";
import QuickSendModal from "@/components/QuickSendModal";
import QRCodeModal from "@/components/QRCodeModal";
import PaymentStatusModal from "@/components/PaymentStatusModal";
import MultiSigFlow from "@/components/MultiSigFlow";

describe("Accessibility audits", () => {
  // ── Navbar ─────────────────────────────────────────────────────────────
  it("Navbar has no accessibility violations", async () => {
    const { container } = render(<Navbar />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ── QuickSendModal ─────────────────────────────────────────────────────
  it("QuickSendModal has no accessibility violations", async () => {
    const { container } = render(
      <QuickSendModal
        isOpen={true}
        onClose={jest.fn()}
        publicKey="GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ"
        xlmBalance="100"
        usdcBalance="50"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("QuickSendModal closed state renders nothing", () => {
    const { container } = render(
      <QuickSendModal
        isOpen={false}
        onClose={jest.fn()}
        publicKey="GABC"
        xlmBalance="100"
        usdcBalance="50"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ── QRCodeModal ────────────────────────────────────────────────────────
  it("QRCodeModal has no accessibility violations", async () => {
    const { container } = render(
      <QRCodeModal
        isOpen={true}
        onClose={jest.fn()}
        publicKey="GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ"
        amount="50"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("QRCodeModal closed state renders nothing", () => {
    const { container } = render(
      <QRCodeModal isOpen={false} onClose={jest.fn()} publicKey="GABC" />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ── PaymentStatusModal ─────────────────────────────────────────────────
  it("PaymentStatusModal has no accessibility violations in processing state", async () => {
    const now = Date.now();
    const baseTimings = {
      building: { startedAt: now, completedAt: null, error: null },
      signing: { startedAt: null, completedAt: null, error: null },
      submitting: { startedAt: null, completedAt: null, error: null },
      confirming: { startedAt: null, completedAt: null, error: null },
    };

    const { container } = render(
      <PaymentStatusModal
        isOpen={true}
        status="building"
        txHash={null}
        error={null}
        failedStep={null}
        stepTimings={baseTimings}
        onClose={jest.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("PaymentStatusModal has no accessibility violations in success state", async () => {
    const now = Date.now();
    const successTimings = {
      building: { startedAt: now - 5000, completedAt: now - 4000, error: null },
      signing: { startedAt: now - 4000, completedAt: now - 3000, error: null },
      submitting: { startedAt: now - 3000, completedAt: now - 2000, error: null },
      confirming: { startedAt: now - 2000, completedAt: now - 1000, error: null },
    };

    const { container } = render(
      <PaymentStatusModal
        isOpen={true}
        status="success"
        txHash="abc123def456"
        error={null}
        failedStep={null}
        stepTimings={successTimings}
        onClose={jest.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("PaymentStatusModal has no accessibility violations in error state", async () => {
    const now = Date.now();
    const errorTimings = {
      building: { startedAt: now - 2000, completedAt: now - 1000, error: null },
      signing: { startedAt: now - 1000, completedAt: null, error: "Network error" },
      submitting: { startedAt: null, completedAt: null, error: null },
      confirming: { startedAt: null, completedAt: null, error: null },
    };

    const { container } = render(
      <PaymentStatusModal
        isOpen={true}
        status="error"
        txHash={null}
        error="Transaction failed"
        failedStep="signing"
        stepTimings={errorTimings}
        onClose={jest.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ── MultiSigFlow ───────────────────────────────────────────────────────
  it("MultiSigFlow build step has no accessibility violations", async () => {
    const { container } = render(
      <MultiSigFlow
        publicKey="GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ"
        xlmBalance="500"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
