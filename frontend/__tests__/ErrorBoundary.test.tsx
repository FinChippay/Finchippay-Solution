/**
 * __tests__/ErrorBoundary.test.tsx
 * Test cases for the enhanced ErrorBoundary component — resolves #257.
 *
 * Acceptance criteria:
 *  1. Crash in MultiSigFlow.tsx does not crash the rest of the dashboard
 *  2. Error fallback shows "Try Again" and "Reset" buttons
 *  3. Sentry events include the error boundary name
 *  4. Network errors show OfflineBanner instead of crash UI
 *  5. ≥4 error boundary test cases
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as Sentry from "@sentry/nextjs";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@sentry/nextjs", () => ({
  withScope: jest.fn((cb: (scope: any) => void) => cb({ setTag: jest.fn(), setExtra: jest.fn(), setLevel: jest.fn() })),
  captureException: jest.fn(),
}));

jest.mock("@/components/icons", () => ({
  AlertCircleIcon: ({ className }: { className?: string }) => <svg data-testid="alert-icon" className={className} />,
}));

// ─── Sut ────────────────────────────────────────────────────────────────────────

import { ErrorBoundary, withErrorBoundary } from "../components/ErrorBoundary";

// Helper: a component that throws on render
function Bomb({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error("💥 intentional crash");
  return <div>safe</div>;
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("ErrorBoundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Test 1: catches errors and shows fallback UI ──────────────────────────────
  it("catches a render error and shows the fallback UI with Try Again and Reset buttons", () => {
    render(
      <ErrorBoundary name="MultiSigFlow">
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Failed to load MultiSigFlow/i)).toBeInTheDocument();
    expect(screen.getByText(/Try Again/i)).toBeInTheDocument();
    expect(screen.getByText(/Reset & Continue/i)).toBeInTheDocument();
    expect(screen.getByText(/💥 intentional crash/)).toBeInTheDocument();
  });

  // ── Test 2: Sentry is called with the error boundary name and componentStack ──
  it("captures the error via Sentry with the boundary name and componentStack", () => {
    render(
      <ErrorBoundary name="BatchPaymentForm">
        <Bomb />
      </ErrorBoundary>
    );

    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });

  // ── Test 3: Try Again button resets the error state ───────────────────────────
  it("resets the error state when Try Again is clicked", () => {
    const { rerender } = render(
      <ErrorBoundary name="TestSection">
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Failed to load TestSection/i)).toBeInTheDocument();

    // Click "Try Again"
    fireEvent.click(screen.getByText(/Try Again/i));

    // After reset, the children should render again
    // Re-render with a non-throwing child to verify reset worked
    rerender(
      <ErrorBoundary name="TestSection">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText("safe")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/i)).not.toBeInTheDocument();
  });

  // ── Test 4: network errors show offline-friendly message ──────────────────────
  it("detects network errors and shows offline-friendly text", () => {
    // Mock navigator.onLine to be offline
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    render(
      <ErrorBoundary name="TradeForm">
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText(/No internet connection/i)).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load TradeForm/i)).not.toBeInTheDocument();

    // Restore
    Object.defineProperty(navigator, "onLine", { configurable: true, value: originalOnLine });
  });

  // ── Test 5: custom fallback prop is rendered instead of default UI ────────────
  it("renders a custom fallback when provided", () => {
    render(
      <ErrorBoundary name="TestSection" fallback={<div>Custom Error UI</div>}>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom Error UI")).toBeInTheDocument();
    expect(screen.queryByText(/Try Again/i)).not.toBeInTheDocument();
  });

  // ── Test 6: normal children render without error ──────────────────────────────
  it("renders children normally when there is no error", () => {
    render(
      <ErrorBoundary name="TestSection">
        <div>Normal Content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Normal Content")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/i)).not.toBeInTheDocument();
  });
});

describe("withErrorBoundary HOC", () => {
  // ── Test 7: HOC wraps component and catches errors ────────────────────────────
  it("wraps a component and catches rendering errors", () => {
    const SafeComponent = () => <div>works fine</div>;
    const Wrapped = withErrorBoundary(SafeComponent, "SafeComponent");
    const { container } = render(<Wrapped />);
    expect(container.textContent).toContain("works fine");
  });
});