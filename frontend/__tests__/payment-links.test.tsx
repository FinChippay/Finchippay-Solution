/**
 * __tests__/payment-links.test.tsx
 * Unit tests for the Payment Links dashboard page (issue #807).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PaymentLinksPage from "@/pages/payment-links";
import {
  clearPaymentLinkStore,
  rememberPaymentLink,
} from "@/lib/paymentLinks";

// recharts uses ResizeObserver in some versions; guard for jsdom.
beforeAll(() => {
  if (typeof (global as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (global as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  clearPaymentLinkStore();
});

const PAYLOAD_A = {
  destination: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN",
  amount: "10",
  memo: "coffee",
};

const PAYLOAD_B = {
  destination: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
  amount: "25",
  memo: "rent",
};

describe("PaymentLinksPage", () => {
  it("shows an empty state when no links exist", () => {
    render(<PaymentLinksPage />);
    expect(
      screen.getByText("No payment links yet"),
    ).toBeInTheDocument();
  });

  it("lists remembered links with amount and status", () => {
    rememberPaymentLink(
      PAYLOAD_A,
      "https://example.com/pay?to=GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN&amount=10&memo=coffee",
    );
    rememberPaymentLink(
      PAYLOAD_B,
      "https://example.com/pay?to=GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ&amount=25&memo=rent",
    );

    render(<PaymentLinksPage />);

    // Both links listed (amounts visible)
    expect(screen.getByText("10 XLM")).toBeInTheDocument();
    expect(screen.getByText("25 XLM")).toBeInTheDocument();
    // Filter counts
    expect(screen.getByText("(2)")).toBeInTheDocument();
    // Two "Active" status badges (one per link) + one Active tab button
    expect(screen.getAllByText("Active", { exact: true }).length).toBeGreaterThanOrEqual(2);
  });

  it("disables a link with the Disable button", async () => {
    rememberPaymentLink(
      PAYLOAD_A,
      "https://example.com/pay?to=GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN&amount=10&memo=coffee",
    );

    render(<PaymentLinksPage />);

    const disableButtons = screen.getAllByRole("button", { name: /disable/i });
    expect(disableButtons).toHaveLength(1);
    fireEvent.click(disableButtons[0]);

    // After disabling, an Enable button appears (link is now disabled).
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /enable/i }),
      ).toBeInTheDocument();
    });
    // The "Disabled" filter tab count is now 1.
    expect(
      screen.getAllByText(/Disabled/).some((el) => el.textContent?.includes("(1)")),
    ).toBe(true);
  });

  it("re-enables a disabled link", async () => {
    rememberPaymentLink(
      PAYLOAD_A,
      "https://example.com/pay?to=GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN&amount=10&memo=coffee",
    );

    render(<PaymentLinksPage />);

    // Disable first
    fireEvent.click(screen.getAllByRole("button", { name: /disable/i })[0]);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /enable/i }),
      ).toBeInTheDocument();
    });

    // Then re-enable
    fireEvent.click(screen.getByRole("button", { name: /enable/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /disable/i }),
      ).toBeInTheDocument();
    });
  });

  it("filters the list by status tab", async () => {
    rememberPaymentLink(
      PAYLOAD_A,
      "https://example.com/pay?to=GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN&amount=10&memo=coffee",
    );
    rememberPaymentLink(
      PAYLOAD_B,
      "https://example.com/pay?to=GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ&amount=25&memo=rent",
    );

    render(<PaymentLinksPage />);
    expect(screen.getByText("10 XLM")).toBeInTheDocument();
    expect(screen.getByText("25 XLM")).toBeInTheDocument();
  });
});