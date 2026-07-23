/**
 * components/Toast.tsx
 * Global toast notification system — top-right slide-in, stacking, auto-dismiss.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon, AlertCircleIcon } from "@/components/icons";
import { useToastContext, type ToastItem } from "@/lib/ToastContext";

// ─── Individual toast item ────────────────────────────────────────────────────

export interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onClose?: () => void;
  onRetry?: () => void;
  duration?: number;
}

export default function Toast({
  message,
  type = "info",
  onClose,
  onRetry,
  duration = 4000,
}: ToastProps) {
  const [startX, setStartX] = useState(0);
  const [currentX, setCurrentX] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => setStartX(e.touches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => setCurrentX(e.touches[0].clientX);
  const handleTouchEnd = () => {
    if (currentX > 0 && currentX - startX > 50) {
      onClose?.();
    }
    setStartX(0);
    setCurrentX(0);
  };

  const deltaX = currentX > startX ? currentX - startX : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: deltaX > 0 ? `translateX(${deltaX}px)` : undefined,
        transition: currentX > 0 ? "none" : undefined,
      }}
      className={clsx(
        "flex items-start gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white",
        "border shadow-xl",
        type === "success" && "bg-emerald-600 border-emerald-500",
        type === "error" && "bg-red-600 border-red-500",
        type === "info" && "bg-slate-800 border-white/10"
      )}
    >
      <div className="flex-shrink-0 mt-0.5">
        {type === "success" && <CheckIcon className="w-4 h-4" />}
        {type === "error" && <AlertCircleIcon className="w-4 h-4" />}
      </div>

      <span className="flex-1 leading-snug">{message}</span>

      <div className="flex items-center gap-2 flex-shrink-0">
        {type === "error" && onRetry && (
          <button
            onClick={() => {
              onClose?.();
              onRetry();
            }}
            className="text-xs font-semibold underline hover:no-underline"
          >
            Retry
          </button>
        )}
        <button
          onClick={() => { onClose?.(); }}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Dismiss notification"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

// ─── Global stacked container (rendered once in _app.tsx) ─────────────────────

function ToastItemWrapper({ toast }: { toast: ToastItem }) {
  const { removeToast } = useToastContext();
  return (
    <Toast
      message={toast.message}
      type={toast.type}
      onClose={() => removeToast(toast.id)}
      onRetry={toast.onRetry}
      duration={toast.duration}
    />
  );
}

export function ToastContainer() {
  const { toasts } = useToastContext();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItemWrapper toast={t} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
