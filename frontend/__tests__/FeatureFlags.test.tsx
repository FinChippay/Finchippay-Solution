import { render, screen } from "@testing-library/react";
import React from "react";
import { FeatureFlagProvider, FeatureGate, useFeatureFlag } from "@/lib/FeatureFlags";

beforeAll(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    })
  ) as jest.Mock;
});

function TestConsumer({ flag }: { flag: string }) {
  const enabled = useFeatureFlag(flag);
  return <div data-testid="flag-value">{enabled ? "enabled" : "disabled"}</div>;
}

describe("FeatureFlags", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_FEATURE_FLAGS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("FeatureFlagProvider + useFeatureFlag", () => {
    it("returns true for a flag with default enabled:true and rollout:100", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="streaming_payments" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("enabled");
    });

    it("returns false for a flag with enabled:false", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="new_dashboard_charts" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("disabled");
    });

    it("returns false for an unknown flag", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="nonexistent_flag" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("disabled");
    });

    it("returns false when no public key is provided and rollout < 100", () => {
      render(
        <FeatureFlagProvider publicKey={null}>
          <TestConsumer flag="ai_payment_assistant" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("disabled");
    });

    it("returns true for a flag with rollout 100 even without publicKey", () => {
      render(
        <FeatureFlagProvider publicKey={null}>
          <TestConsumer flag="streaming_payments" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("enabled");
    });
  });

  describe("FeatureGate", () => {
    it("renders children when flag is enabled", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <FeatureGate flag="streaming_payments">
            <div data-testid="content">Feature Content</div>
          </FeatureGate>
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("content")).toHaveTextContent("Feature Content");
    });

    it("renders fallback when flag is disabled", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <FeatureGate flag="new_dashboard_charts" fallback={<div data-testid="fallback">Coming Soon</div>}>
            <div data-testid="content">Feature Content</div>
          </FeatureGate>
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("fallback")).toHaveTextContent("Coming Soon");
      expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    });

    it("renders nothing when flag is disabled and no fallback provided", () => {
      const { container } = render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <FeatureGate flag="new_dashboard_charts">
            <div data-testid="content">Feature Content</div>
          </FeatureGate>
        </FeatureFlagProvider>
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("Percentage rollout", () => {
    it("deterministically assigns users based on public key hash", () => {
      const keyA = "GAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const keyB = "GBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      const { rerender } = render(
        <FeatureFlagProvider publicKey={keyA}>
          <TestConsumer flag="ai_payment_assistant" />
        </FeatureFlagProvider>
      );
      const valA = screen.getByTestId("flag-value").textContent;

      rerender(
        <FeatureFlagProvider publicKey={keyB}>
          <TestConsumer flag="ai_payment_assistant" />
        </FeatureFlagProvider>
      );
      const valB = screen.getByTestId("flag-value").textContent;

      // Same key should always give same result (deterministic)
      render(
        <FeatureFlagProvider publicKey={keyA}>
          <TestConsumer flag="ai_payment_assistant" />
        </FeatureFlagProvider>
      );
      const valAagain = screen.getAllByTestId("flag-value").pop()?.textContent;
      expect(valA).toBe(valAagain);
    });
  });

  describe("NEXT_PUBLIC_FEATURE_FLAGS override", () => {
    it("overrides defaults via env var", () => {
      process.env.NEXT_PUBLIC_FEATURE_FLAGS = JSON.stringify({
        new_dashboard_charts: { enabled: true, rollout: 100 },
      });

      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="new_dashboard_charts" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("enabled");
    });

    it("supports shorthand boolean in env var override", () => {
      process.env.NEXT_PUBLIC_FEATURE_FLAGS = JSON.stringify({
        ledger_wallet: true,
      });

      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="ledger_wallet" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("enabled");
    });
  });

  // ── New flags introduced in #103 ────────────────────────────────────────────

  describe("new_portfolio and events_page flags (#103)", () => {
    it("new_portfolio returns false when rollout is 0%", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="new_portfolio" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("disabled");
    });

    it("events_page returns false when rollout is 0%", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="events_page" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("disabled");
    });

    it("new_portfolio can be enabled via env override", () => {
      process.env.NEXT_PUBLIC_FEATURE_FLAGS = JSON.stringify({
        new_portfolio: { enabled: true, rollout: 100 },
      });

      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <TestConsumer flag="new_portfolio" />
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("flag-value")).toHaveTextContent("enabled");
    });

    it("FeatureGate renders fallback for new_portfolio when flag is off", () => {
      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <FeatureGate
            flag="new_portfolio"
            fallback={<div data-testid="fallback">Coming Soon</div>}
          >
            <div data-testid="content">Portfolio Content</div>
          </FeatureGate>
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("fallback")).toHaveTextContent("Coming Soon");
      expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    });

    it("FeatureGate renders content for new_portfolio when env override enables it", () => {
      process.env.NEXT_PUBLIC_FEATURE_FLAGS = JSON.stringify({
        new_portfolio: { enabled: true, rollout: 100 },
      });

      render(
        <FeatureFlagProvider publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890">
          <FeatureGate
            flag="new_portfolio"
            fallback={<div data-testid="fallback">Coming Soon</div>}
          >
            <div data-testid="content">Portfolio Content</div>
          </FeatureGate>
        </FeatureFlagProvider>
      );
      expect(screen.getByTestId("content")).toHaveTextContent("Portfolio Content");
      expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
    });
  });
});
