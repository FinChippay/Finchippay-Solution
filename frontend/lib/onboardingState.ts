// frontend/lib/onboardingState.ts
"use client";

import { useState } from "react";

export const STORAGE_KEY = "finchippay:onboarding";
export const ONBOARDING_STATE_VERSION = 1;
export const ONBOARDING_STEP_COUNT = 5;

export interface OnboardingProgress {
  /** Schema version used to safely evolve persisted onboarding data. */
  version: number;
  /** Indices of steps that the user has completed */
  completedSteps: number[];
  /** Whether the entire tour was completed */
  completed: boolean;
  /** Timestamp of the last interaction */
  lastSeen: number;
  /** Feature‑specific version flags to avoid showing stale announcements */
  featureVersions: Record<string, boolean>;
}

const DEFAULT_PROGRESS: OnboardingProgress = {
  version: ONBOARDING_STATE_VERSION,
  completedSteps: [],
  completed: false,
  lastSeen: 0,
  featureVersions: {},
};

function defaultProgress(): OnboardingProgress {
  return { ...DEFAULT_PROGRESS, completedSteps: [], featureVersions: {} };
}

function coerceBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function validateProgress(value: unknown): OnboardingProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  // A missing version is the legacy schema. Future or malformed versions are
  // reset so they cannot skip users through an unknown tour.
  if (raw.version !== undefined && raw.version !== ONBOARDING_STATE_VERSION) {
    return null;
  }

  const completedSteps = Array.isArray(raw.completedSteps)
    ? [...new Set(raw.completedSteps.filter(
        (step): step is number =>
          typeof step === "number" &&
          Number.isInteger(step) &&
          step >= 0 &&
          step < ONBOARDING_STEP_COUNT,
      ))].sort((a, b) => a - b)
    : [];

  const featureVersions =
    raw.featureVersions &&
    typeof raw.featureVersions === "object" &&
    !Array.isArray(raw.featureVersions)
      ? Object.fromEntries(
          Object.entries(raw.featureVersions as Record<string, unknown>).map(
            ([key, seen]) => [key, coerceBoolean(seen)],
          ),
        )
      : {};

  return {
    version: ONBOARDING_STATE_VERSION,
    completedSteps,
    completed: coerceBoolean(raw.completed),
    lastSeen:
      typeof raw.lastSeen === "number" && Number.isFinite(raw.lastSeen)
        ? raw.lastSeen
        : 0,
    featureVersions,
  };
}

function saveProgress(progress: OnboardingProgress): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {}
}

export function getTourProgress(): OnboardingProgress {
  if (typeof window === "undefined") {
    return defaultProgress();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const progress = validateProgress(parsed);
      if (progress) {
        // Persist valid legacy data in the current schema after migration.
        if (parsed.version !== ONBOARDING_STATE_VERSION) saveProgress(progress);
        return progress;
      }
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
  return defaultProgress();
}

export function markStepComplete(stepIndex: number): void {
  const progress = getTourProgress();
  if (!progress.completedSteps.includes(stepIndex)) {
    progress.completedSteps.push(stepIndex);
  }
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

export function markTourComplete(): void {
  const progress = getTourProgress();
  progress.completed = true;
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

export function resetTour(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Return true if the tour should be shown for the given feature version. */
export function shouldShowTour(featureVersion: string): boolean {
  const progress = getTourProgress();
  if (progress.completed) return false;
  if (progress.featureVersions[featureVersion]) return false;
  return true;
}

export function markFeatureSeen(featureVersion: string): void {
  const progress = getTourProgress();
  progress.featureVersions[featureVersion] = true;
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

/** Simple analytics – uses Plausible if available */
export function trackOnboardingEvent(event: string, data?: Record<string, unknown>): void {
  if (typeof window !== "undefined" && (window as any).plausible) {
    (window as any).plausible(event, { props: data });
  }
}

/** React hook for easy consumption */
export function useOnboarding() {
  const [progress, setProgress] = useState<OnboardingProgress>(getTourProgress());
  const refresh = () => setProgress(getTourProgress());
  return {
    progress,
    markStepComplete: (i: number) => {
      markStepComplete(i);
      refresh();
    },
    markTourComplete: () => {
      markTourComplete();
      refresh();
    },
    resetTour: () => {
      resetTour();
      refresh();
    },
    shouldShowTour,
    markFeatureSeen,
    trackOnboardingEvent,
  };
}
