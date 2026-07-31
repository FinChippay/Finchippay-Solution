/**
 * hooks/useOnboardingTour.ts
 *
 * State management hook for the interactive onboarding tour (Issue #254).
 *
 * Persistence contract (localStorage keys):
 *   finchippay:onboarding:completed   "true" → tour was finished
 *   finchippay:onboarding:dismissed   "true" → user chose "Don't show again"
 *   finchippay:onboarding:step        "<number>" → last step index the user reached
 */

import { useState, useEffect, useCallback } from "react";

// ─── localStorage keys ────────────────────────────────────────────────────────

export const ONBOARDING_KEY_COMPLETED = "finchippay:onboarding:completed";
export const ONBOARDING_KEY_DISMISSED = "finchippay:onboarding:dismissed";
export const ONBOARDING_KEY_STEP = "finchippay:onboarding:step";

// ─── helpers ──────────────────────────────────────────────────────────────────

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readInt(key: string, fallback = 0): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // localStorage can be unavailable in private browsing modes – fail silently.
  }
}

function writeInt(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // fail silently
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface OnboardingTourState {
  /** Whether the tour overlay is currently shown. */
  isRunning: boolean;
  /** Index of the step the tour is currently on (0-based). */
  stepIndex: number;
  /** True once the user has finished or skipped all steps. */
  isCompleted: boolean;
  /** True when the user chose "Don't show again". */
  isDismissed: boolean;
  /** True when the tour was started but not yet completed — a resume prompt should be shown. */
  isResumable: boolean;
  /** Start or resume the tour. */
  startTour: () => void;
  /** Advance to the next step (or finish). */
  nextStep: (total: number) => void;
  /** Go back to the previous step. */
  prevStep: () => void;
  /** Skip the tour without completing it (progress is kept so user can resume). */
  skipTour: () => void;
  /** Mark the tour as fully completed. */
  completeTour: () => void;
  /** Permanently disable auto-start. */
  dismissForever: () => void;
  /** Jump to a specific step index. */
  setStepIndex: (index: number) => void;
}

/**
 * Manages onboarding tour state with localStorage persistence.
 *
 * Auto-start behaviour:
 *   - First visit (nothing stored): tour starts automatically.
 *   - Returning visit, tour incomplete and not dismissed: "Resume Tour" banner is shown.
 *   - Dismissed or completed: tour does not auto-start.
 */
export function useOnboardingTour(): OnboardingTourState {
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndexState] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isResumable, setIsResumable] = useState(false);

  // ── Hydrate from localStorage once the component mounts ──────────────────
  useEffect(() => {
    const completed = readBool(ONBOARDING_KEY_COMPLETED);
    const dismissed = readBool(ONBOARDING_KEY_DISMISSED);
    const savedStep = readInt(ONBOARDING_KEY_STEP, 0);

    setIsCompleted(completed);
    setIsDismissed(dismissed);

    if (!completed && !dismissed) {
      if (savedStep > 0) {
        // User started the tour on a previous visit but didn't finish.
        setStepIndexState(savedStep);
        setIsResumable(true);
      } else {
        // Brand-new visitor — auto-start immediately.
        setIsRunning(true);
      }
    }
    // completed or dismissed → do nothing, tour will not auto-start.
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const startTour = useCallback(() => {
    setIsRunning(true);
    setIsResumable(false);
  }, []);

  const setStepIndex = useCallback((index: number) => {
    setStepIndexState(index);
    writeInt(ONBOARDING_KEY_STEP, index);
  }, []);

  const nextStep = useCallback(
    (total: number) => {
      setStepIndexState((prev) => {
        const next = prev + 1;
        if (next >= total) {
          // Finished.
          writeBool(ONBOARDING_KEY_COMPLETED, true);
          writeInt(ONBOARDING_KEY_STEP, 0);
          setIsCompleted(true);
          setIsRunning(false);
          return 0;
        }
        writeInt(ONBOARDING_KEY_STEP, next);
        return next;
      });
    },
    []
  );

  const prevStep = useCallback(() => {
    setStepIndexState((prev) => {
      const next = Math.max(0, prev - 1);
      writeInt(ONBOARDING_KEY_STEP, next);
      return next;
    });
  }, []);

  const skipTour = useCallback(() => {
    // Persist current step so user can resume later; hide the overlay.
    setIsRunning(false);
    setIsResumable(true);
    // stepIndex is already written by setStepIndex / nextStep.
  }, []);

  const completeTour = useCallback(() => {
    writeBool(ONBOARDING_KEY_COMPLETED, true);
    writeInt(ONBOARDING_KEY_STEP, 0);
    setIsCompleted(true);
    setIsRunning(false);
    setIsResumable(false);
    setStepIndexState(0);
  }, []);

  const dismissForever = useCallback(() => {
    writeBool(ONBOARDING_KEY_DISMISSED, true);
    setIsDismissed(true);
    setIsRunning(false);
    setIsResumable(false);
  }, []);

  return {
    isRunning,
    stepIndex,
    isCompleted,
    isDismissed,
    isResumable,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
    dismissForever,
    setStepIndex,
  };
}
