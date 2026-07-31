"use client";

import { useState } from "react";
import { shouldShowTour, markFeatureSeen, trackOnboardingEvent } from "@/lib/onboardingState";

interface FeatureAnnouncementProps {
  featureId: string;
  title: string;
  description: string;
  onStartTour?: () => void;
}

export default function FeatureAnnouncement({ featureId, title, description, onStartTour }: FeatureAnnouncementProps) {
  const [visible, setVisible] = useState(shouldShowTour(featureId));
  const [dismissed, setDismissed] = useState(false);

  if (!visible || dismissed) return null;

  const handleStart = () => {
    markFeatureSeen(featureId);
    trackOnboardingEvent("feature_tour_started", { feature: featureId });
    setVisible(false);
    onStartTour?.();
  };

  const handleDismiss = () => {
    markFeatureSeen(featureId);
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-slide-up">
      <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-stellar-500/30 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="text-lg">🆕</span>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>
          </div>
          <button onClick={handleDismiss} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Dismiss">×</button>
        </div>
        {onStartTour && (
          <button onClick={handleStart} className="mt-3 w-full text-xs bg-stellar-500 hover:bg-stellar-600 text-white px-3 py-1.5 rounded-lg font-medium">
            Take a quick tour
          </button>
        )}
      </div>
    </div>
  );
}