/**
 * components/OfflineBanner.tsx
 * Shows a persistent banner when the user is offline.
 * Detects online/offline via navigator.onLine + online/offline events.
 */

import { useState, useEffect } from "react";

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    // Set initial state
    setIsOffline(!navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-slide-down" role="alert" aria-live="polite">
      <div className="mx-auto max-w-3xl px-4 py-2">
        <div className="rounded-b-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 backdrop-blur-md text-center shadow-lg">
          <p className="text-sm font-medium text-amber-200 flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.364 5.636a9 9 0 010 12.728m-2.829-9.9a5 5 0 010 7.072M9.172 14.828a5 5 0 010-7.072m-2.828 9.9a9 9 0 010-12.728M12 3v2m0 14v2"
              />
            </svg>
            You are offline
          </p>
          <p className="text-xs text-amber-200/70 mt-0.5">
            Showing cached data — some features may be limited
          </p>
        </div>
      </div>
    </div>
  );
}
