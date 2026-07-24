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
 * State is managed externally by the useOnboardingTour hook, which is called
 * in _app.tsx so that the Navbar and this component share the same instance.
 */

import dynamic from "next/dynamic";
import { useCallback } from "react";
import type { CallBackProps, Step } from "react-joyride";
import type { OnboardingTourState } from "@/hooks/useOnboardingTour";

// ─── react-joyride is client-only (uses DOM APIs) ────────────────────────────
const Joyride = dynamic(() => import("react-joyride"), { ssr: false });

// ─── Tour steps ───────────────────────────────────────────────────────────────

/**
 * CSS target selectors for each step.
 * Each selector must match a real DOM element rendered by the page.
 * If the element does not exist on the current page the step is simply skipped
 * by react-joyride (TARGET_NOT_FOUND event).
 */
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
    primaryColor: "#0ea5e9", // stellar-500 (matches the app's brand colour)
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
  tour: OnboardingTourState;
}

export default function OnboardingTour({ tour }: OnboardingTourProps) {
  /**
   * Called by react-joyride on every tour event.
   */
  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type } = data;

      const isFinished = status === "finished";
      const isSkipped = status === "skipped";

      if (type === "step:after") {
        if (action === "next") {
          tour.nextStep(STEP_COUNT);
        } else if (action === "prev") {
          tour.prevStep();
        } else if (action === "close" || action === "skip") {
          tour.setStepIndex(index);
          tour.skipTour();
        }
      }

      if (type === "tour:end") {
        if (isFinished) {
          tour.completeTour();
        } else if (isSkipped) {
          // Save current step index so the tour can be resumed.
          tour.setStepIndex(index);
          tour.skipTour();
        }
      }
    },
    [tour]
  );

  return (
    <>
      {/* ── react-joyride tour overlay ────────────────────────────────── */}
      {tour.isRunning && (
        <Joyride
          steps={TOUR_STEPS}
          stepIndex={tour.stepIndex}
          run={tour.isRunning}
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

      {/* ── Resume banner ─────────────────────────────────────────────── */}
      {tour.isResumable && !tour.isRunning && (
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

export { useOnboardingTour } from "@/hooks/useOnboardingTour";
export {
  ONBOARDING_KEY_COMPLETED,
  ONBOARDING_KEY_DISMISSED,
  ONBOARDING_KEY_STEP,
} from "@/hooks/useOnboardingTour";
