/**
 * components/OnboardingTour.tsx
 *
 * Interactive, step-by-step onboarding tour for first-time users (Issue #254).
 *
 * Features:
 *   - 5 guided steps covering Wallet, Dashboard, Send Payment, Escrow, and Streaming.
 *   - Auto-starts on first visit; resumes where the user left off.
 *   - Skip button on every step (preserves progress for later resume).
 *   - "Don't show again" permanently disables auto-start.
 *   - Resume banner shown when the tour is incomplete but not currently running.
 *   - Manual launch available from Navbar via the startTour callback.
 *
 * Supports two APIs:
 *   1. Hook-based (from _app.tsx): pass `tour` from useOnboardingTour hook.
 *   2. Props-based (from dashboard.tsx): pass `isVisible`, `onComplete`, `onSkip`.
 *      When `tour` is absent, the hook is used internally.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CallBackProps, Step } from "react-joyride";
import type { OnboardingTourState } from "@/hooks/useOnboardingTour";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import {
  getTourProgress,
  markStepComplete,
  markTourComplete,
  trackOnboardingEvent,
} from "@/lib/onboardingState";
import { getPaymentHistory } from "@/lib/stellar";
import { useWalletOptional } from "@/lib/useWallet";

// Import onboarding state utilities for progress tracking and analytics

// ─── react-joyride is client-only (uses DOM APIs) ────────────────────────────
const Joyride = dynamic(() => import("react-joyride"), { ssr: false });

// ─── Tour steps ───────────────────────────────────────────────────────────────

export const TOUR_STEPS: Step[] = [
  {
    target: '[data-tour="wallet-connect"]',
    title: "Connect your Freighter wallet",
    content:
      "Click here to connect your Freighter browser extension. Your private keys never leave the extension — only public transactions are broadcast to Stellar.",
    placement: "bottom",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard"]',
    title: "Your dashboard",
    content:
      "This is your control centre. View your XLM and USDC balances, track payment charts, and access quick-action shortcuts for sending and receiving.",
    placement: "bottom",
    disableBeacon: true,
  },
  {
    target: '[data-tour="send-payment"]',
    title: "Send your first payment",
    content:
      "Enter a Stellar address or federated name, choose an amount and asset, then sign with Freighter. Payments settle in 3–5 seconds.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-tour="escrow"]',
    title: "Explore escrow",
    content:
      "Need to hold funds until a condition is met? Create a time-locked escrow on-chain. The recipient can only claim after the release ledger.",
    placement: "bottom",
    disableBeacon: true,
  },
  {
    target: '[data-tour="streaming-payments"]',
    title: "Try streaming payments",
    content:
      "Stream XLM by the ledger — perfect for subscriptions, payroll, or micro-payments. Open, top up, and close streams at any time.",
    placement: "bottom",
    disableBeacon: true,
  },
];

export const STEP_COUNT = TOUR_STEPS.length;

// ─── Joyride locale strings ───────────────────────────────────────────────────

const LOCALE = {
  back: "Back",
  close: "Close",
  last: "Finish",
  next: "Next",
  nextLabelWithProgress: "Next (Step {step} of {steps})",
  open: "Open",
  skip: "Skip tour",
};

// ─── Joyride styles ───────────────────────────────────────────────────────────

const JOYRIDE_STYLES = {
  options: {
    primaryColor: "#0ea5e9",
    zIndex: 10000,
  },
  tooltip: {
    borderRadius: "0.75rem",
    padding: "1.25rem",
  },
  tooltipTitle: {
    fontSize: "1rem",
    fontWeight: 600,
  },
  buttonNext: {
    borderRadius: "0.5rem",
  },
  buttonBack: {
    borderRadius: "0.5rem",
  },
  buttonSkip: {
    color: "#64748b",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface OnboardingTourProps {
  /** Tour state provided by the useOnboardingTour hook from _app.tsx. */
  tour?: OnboardingTourState;
  /** Whether the tour overlay should be visible (used when tour is absent). */
  isVisible?: boolean;
  /** Called when the user completes all tour steps (used when tour is absent). */
  onComplete?: () => void;
  /** Called when the user skips the tour (used when tour is absent). */
  onSkip?: () => void;
}

export default function OnboardingTour({ tour: externalTour, isVisible, onComplete, onSkip }: OnboardingTourProps) {
  // Use internal hook when no external tour state is provided (props-based API)
  const internalTour = useOnboardingTour();
  const tour = externalTour || internalTour;

  // `useWalletOptional` never throws, so the tour still renders (without
  // wallet-aware skipping) when mounted outside a WalletProvider, e.g. in tests.
  const wallet = useWalletOptional();
  const walletConnected = Boolean(wallet?.publicKey);
  const [hasPaymentHistory, setHasPaymentHistory] = useState(false);

  // Check for existing payment history once a wallet is connected, so the
  // "Send your first payment" step can be skipped for returning users.
  useEffect(() => {
    const publicKey = wallet?.publicKey;
    if (!publicKey) return;

    let cancelled = false;
    getPaymentHistory(publicKey, 1)
      .then((history) => {
        if (!cancelled) setHasPaymentHistory(history.records.length > 0);
      })
      .catch(() => {
        // Network/Horizon errors just mean we keep showing the step.
      });

    return () => {
      cancelled = true;
    };
  }, [wallet?.publicKey]);

  // Compute filtered steps: exclude steps already completed in a previous
  // tour session, plus steps whose goal the user has already accomplished.
  const filteredSteps: Step[] = useMemo(() => {
    const { completedSteps } = getTourProgress();
    return TOUR_STEPS.filter((step, idx) => {
      if (completedSteps.includes(idx)) return false;
      if (walletConnected && step.target === '[data-tour="wallet-connect"]') return false;
      if (hasPaymentHistory && step.target === '[data-tour="send-payment"]') return false;
      return true;
    });
  }, [walletConnected, hasPaymentHistory]);

  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type, step } = data;

      // Emit analytics events for step navigation
      if (type === "step:after") {
        if (action === "next" || action === "prev") {
          trackOnboardingEvent("onboarding_step_completed", { stepIndex: index });
        }
      }

      const isFinished = status === "finished";
      const isSkipped = status === "skipped";

      if (type === "step:after") {
        if (action === "next") {
          // Mark the current step as completed
          markStepComplete(index);
          tour.nextStep(filteredSteps.length);
        } else if (action === "prev") {
          tour.prevStep();
        } else if (action === "close" || action === "skip") {
          tour.setStepIndex(index);
          tour.skipTour();
          onSkip?.();
          trackOnboardingEvent("onboarding_skipped");
        }
      }

      if (type === "tour:end") {
        if (isFinished) {
          markTourComplete();
          tour.completeTour();
          onComplete?.();
          trackOnboardingEvent("onboarding_completed");
        } else if (isSkipped) {
          tour.setStepIndex(index);
          tour.skipTour();
          onSkip?.();
          trackOnboardingEvent("onboarding_skipped");
        }
      }
    },
    [tour, onComplete, onSkip, filteredSteps]
  );

  const isRunning = externalTour ? tour.isRunning : (isVisible ?? tour.isRunning);

  return (
    <>
      {/* ── react-joyride tour overlay ────────────────────────────────── */}
      {isRunning && (
        <Joyride
          steps={filteredSteps}
          stepIndex={tour.stepIndex}
          run={isRunning}
          continuous
          showProgress
          showSkipButton
          disableOverlayClose
          scrollToFirstStep
          locale={LOCALE}
          styles={JOYRIDE_STYLES}
          callback={handleJoyrideCallback}
        />
      )}

      {/* ── Resume banner (only shown when using external hook-based API) ── */}
      {externalTour && tour.isResumable && !tour.isRunning && (
        <div
          role="status"
          aria-live="polite"
          data-testid="onboarding-resume-banner"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-3 rounded-xl border border-stellar-500/30 bg-white p-4 shadow-xl dark:bg-cosmos-800"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Resume your onboarding tour
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Pick up where you left off — step {tour.stepIndex + 1} of{" "}
              {STEP_COUNT}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={tour.startTour}
              className="btn-primary flex-1 px-3 py-1.5 text-xs"
              data-testid="onboarding-resume-btn"
            >
              Resume Tour
            </button>
            <button
              onClick={tour.dismissForever}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-cosmos-700 dark:text-slate-400 dark:hover:bg-cosmos-700"
              data-testid="onboarding-dismiss-btn"
            >
              Don&apos;t show again
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Re-export hook and constants for consumers ───────────────────────────────

export {
  ONBOARDING_KEY_COMPLETED,
  ONBOARDING_KEY_DISMISSED,
  ONBOARDING_KEY_STEP,
} from "@/hooks/useOnboardingTour";
