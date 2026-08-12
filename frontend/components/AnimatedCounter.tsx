/**
 * components/AnimatedCounter.tsx
 * Smoothly animates a numeric value when it changes (#328).
 *
 * Uses framer-motion's useSpring to interpolate from the previous value to
 * the new one, so balance and transaction counts change visually rather than
 * snapping — a small detail that makes the dashboard feel live instead of
 * like a spreadsheet.
 *
 * Respects `prefers-reduced-motion`: when the user prefers reduced motion,
 * the value updates instantly because a continuous spring would be exhausting
 * for anyone sensitive to motion.
 *
 * Formatting:
 *   - decimals defaults to 0 — money flows accept fractional digits via
 *     `decimals` (e.g. 4 for XLM balances).
 *   - prefix and suffix are rendered outside the animated digits, so a unit
 *     like "XLM" stays put while the digits change ("1,234.5678 XLM").
 */

import { useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { type ReactNode, useEffect, useRef } from "react";

interface AnimatedCounterProps {
  /** Target value. */
  value: number;
  /** Decimal places to round to when formatting. */
  decimals?: number;
  /** Optional prefix, e.g. "$". */
  prefix?: ReactNode;
  /** Optional suffix, e.g. "XLM" — accepts text or a styled element. */
  suffix?: ReactNode;
  /** Locale to use for thousands separators. */
  locale?: string;
}

/** Hard-clamp so a malformed `<span>` cannot overflow when the caret blinks. */
function formatNumber(
  n: number,
  decimals: number,
  locale: string,
): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Number(n.toFixed(decimals));
  return rounded.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function AnimatedCounter({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  locale = "en-US",
}: AnimatedCounterProps) {
  const prefersReducedMotion = useReducedMotion();
  // Disable the spring altogether when reduced-motion is requested: the value
  // should jump directly to its target so the user is not stuck watching a
  // number crawl upward.
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, {
    stiffness: 90,
    damping: 20,
    mass: 0.6,
  });

  // Push the new target into the spring on every change. We capture the
  // previous DOM text and update it on every animation frame, which is the
  // lightest-weight way to render an animated numeric value without re-rendering
  // the whole component on every frame.
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      motionValue.set(value);
      if (ref.current) {
        ref.current.textContent = formatNumber(value, decimals, locale);
      }
      return;
    }

    motionValue.set(value);
    const unsubscribe = spring.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = formatNumber(latest, decimals, locale);
      }
    });
    return () => unsubscribe();
  }, [value, decimals, locale, motionValue, spring, prefersReducedMotion]);

  return (
    <span>
      {prefix}
      <span ref={ref} aria-live="polite" aria-atomic="true">
        {formatNumber(value, decimals, locale)}
      </span>
      {suffix}
    </span>
  );
}
