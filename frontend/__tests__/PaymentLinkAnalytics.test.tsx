/**
 * __tests__/PaymentLinkAnalytics.test.tsx
 * Unit tests for the PaymentLinkAnalytics component (issue #807).
 */

import { render, screen } from "@testing-library/react";
import PaymentLinkAnalytics from "@/components/PaymentLinkAnalytics";
import type { PaymentLinkRecord } from "@/lib/paymentLinks";

beforeAll(() => {
  if (typeof (global as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (global as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function makeLink(overrides: Partial<PaymentLinkRecord> = {}): PaymentLinkRecord {
  return {
    id: "pl_test",
    payload: { destination: "GABC", amount: "10", memo: "coffee" },
    url: "https://example.com/pay?to=GABC&amount=10",
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("PaymentLinkAnalytics", () => {
  it("renders nothing when there are no links", () => {
    const { container } = render(<PaymentLinkAnalytics links={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows aggregate stat cards", () => {
    const links = [
      makeLink({ viewCount: 5, paymentCount: 2, totalCollected: 20 }),
      makeLink({ viewCount: 3, paymentCount: 1, totalCollected: 10 }),
    ];
    render(<PaymentLinkAnalytics links={links} />);

    expect(screen.getByText("Payment Links Analytics")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument(); // total views
    expect(screen.getByText("3")).toBeInTheDocument(); // total payments
    expect(screen.getByText("30 XLM")).toBeInTheDocument(); // total collected
  });

  it("shows conversion rate as a percentage", () => {
    const links = [makeLink({ viewCount: 4, paymentCount: 1, totalCollected: 10 })];
    render(<PaymentLinkAnalytics links={links} />);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows a no-activity message when links exist but no views/payments", () => {
    const links = [makeLink({ viewCount: 0, paymentCount: 0, totalCollected: 0 })];
    render(<PaymentLinkAnalytics links={links} />);
    expect(
      screen.getByText(/No view or payment activity yet/i),
    ).toBeInTheDocument();
  });
});