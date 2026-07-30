/**
 * __tests__/accessibility.test.tsx
 * Automated axe-core (jest-axe) accessibility checks across key components
 * and pages. Complements the color-contrast-focused e2e checks in
 * e2e/a11y.spec.ts and the broader multi-page scan in e2e/accessibility.spec.ts.
 */

import React from "react";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe, toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

// jsdom does not implement matchMedia — polyfill so ThemeProvider doesn't throw.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// ─── Shared mocks (mirrors __tests__/snapshots.test.tsx) ──────────────────────

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ stellar: { usd: 0.12 } }),
  } as Response)
) as unknown as typeof fetch;

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    query: {},
    events: { on: jest.fn(), off: jest.fn() },
  }),
}));

jest.mock("next/link", () => {
  const Link = ({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = "Link";
  return Link;
});

jest.mock("next/head", () => {
  const Head = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Head.displayName = "Head";
  return Head;
});

jest.mock("@/lib/stellar", () => ({
  getNetworkConfig: jest.fn(() => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" })),
  fetchNetworkFeeStats: jest.fn(() => Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" })),
  getPaymentHistory: jest.fn(() => Promise.resolve({ records: [], hasMore: false })),
  shortenAddress: jest.fn((addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr: string) => typeof addr === "string" && addr.startsWith("G")),
}));

jest.mock("@/lib/wallet", () => ({
  connectWallet: jest.fn(),
  performSEP0010Auth: jest.fn(() => Promise.resolve({ error: null })),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => ({
    publicKey: null,
    connectWallet: jest.fn(),
  }),
}));

jest.mock("@/lib/priceAlerts", () => ({
  loadAlerts: jest.fn(() => []),
  PRICE_ALERTS_STORAGE_KEY: "finchippay:price-alerts",
}));

jest.mock("@/utils/format", () => ({
  formatAsset: jest.fn((amount: string, asset: string) => `${amount} ${asset}`),
  shortenAddress: jest.fn((addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`),
  timeAgo: jest.fn(() => "2 min ago"),
  copyToClipboard: jest.fn(),
}));

jest.mock("@/lib/addressBook", () => ({
  loadAddressBookContacts: jest.fn(() => []),
  upsertAddressBookContact: jest.fn(),
}));

jest.mock("@/lib/exportTransactions", () => ({
  exportTransactionsCSV: jest.fn(() => Promise.resolve("")),
  downloadCSV: jest.fn(),
}));

jest.mock("@/hooks/useContacts", () => ({
  useContacts: () => ({ contacts: [] }),
}));

// ─── Component imports (after mocks) ───────────────────────────────────────────

import Navbar from "@/components/Navbar";
import TransactionList from "@/components/TransactionList";
import ExportModal from "@/components/ExportModal";
import ContactExportModal from "@/components/ContactExportModal";
import ScreenReaderAnnouncements from "@/components/ScreenReaderAnnouncements";
import PaymentStatusModal from "@/components/PaymentStatusModal";
import AccessibilityStatement from "@/pages/accessibility";
import { ThemeProvider } from "@/lib/ThemeContext";

async function expectNoViolations(container: Element) {
  const results = await axe(container);
  expect(results).toHaveNoViolations();
}

describe("Accessibility (axe-core)", () => {
  it("Navbar (disconnected state) has no violations", async () => {
    const { container } = render(
      <ThemeProvider>
        <Navbar />
      </ThemeProvider>
    );
    await expectNoViolations(container);
  });

  it("TransactionList (empty state) has no violations", async () => {
    const { container } = render(<TransactionList publicKey="GBMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCK" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expectNoViolations(container);
  });

  it("ExportModal has no violations", async () => {
    const { container } = render(
      <ExportModal publicKey="GBMOCK" isOpen={true} onClose={jest.fn()} />
    );
    await expectNoViolations(container);
  });

  it("ContactExportModal has no violations", async () => {
    const { container } = render(<ContactExportModal isOpen={true} onClose={jest.fn()} />);
    await expectNoViolations(container);
  });

  it("PaymentStatusModal (in-progress state) has no violations", async () => {
    const { container } = render(
      <PaymentStatusModal
        isOpen={true}
        status="submitting"
        txHash={null}
        error={null}
        failedStep={null}
        stepTimings={{
          building: { startedAt: 1000, completedAt: 1500, error: null },
          signing: { startedAt: 1500, completedAt: 2000, error: null },
          submitting: { startedAt: 2000, completedAt: null, error: null },
          confirming: { startedAt: null, completedAt: null, error: null },
        }}
        onClose={jest.fn()}
      />
    );
    await expectNoViolations(container);
  });

  it("ScreenReaderAnnouncements live regions have no violations", async () => {
    const { container } = render(<ScreenReaderAnnouncements />);
    await expectNoViolations(container);
  });

  it("Accessibility statement page has no violations", async () => {
    const { container } = render(<AccessibilityStatement />);
    await expectNoViolations(container);
  });
});
