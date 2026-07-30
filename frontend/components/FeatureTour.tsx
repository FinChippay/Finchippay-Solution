/**
 * components/FeatureTour.tsx
 *
 * Small, reusable Joyride wrapper for the 2-3 step mini-tours that
 * FeatureAnnouncement triggers when a user opts into "Take a quick tour"
 * for a newly released feature (Issue #375). Kept separate from the main
 * OnboardingTour so feature tours don't interact with its progress state.
 */

"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import type { CallBackProps, Step } from "react-joyride";
import { trackOnboardingEvent } from "@/lib/onboardingState";

const Joyride = dynamic(() => import("react-joyride"), { ssr: false });

export interface FeatureTourProps {
  /** Identifier matching the FeatureAnnouncement that triggered this tour. */
  featureId: string;
  /** 2-3 steps walking through the new feature. */
  steps: Step[];
  isVisible: boolean;
  onClose: () => void;
}

export default function FeatureTour({ featureId, steps, isVisible, onClose }: FeatureTourProps) {
  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { status, type } = data;
      if (type === "tour:end") {
        trackOnboardingEvent(
          status === "finished" ? "feature_tour_completed" : "feature_tour_skipped",
          { feature: featureId }
        );
        onClose();
      }
    },
    [featureId, onClose]
  );

  if (!isVisible) return null;

  return (
    <Joyride
      steps={steps}
      run={isVisible}
      continuous
      showProgress
      showSkipButton
      disableOverlayClose
      scrollToFirstStep
      styles={{ options: { primaryColor: "#0ea5e9", zIndex: 10000 } }}
      callback={handleCallback}
    />
  );
}
