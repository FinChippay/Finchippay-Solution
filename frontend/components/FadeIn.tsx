/**
 * components/FadeIn.tsx
 * Lightweight motion wrappers for staggered entrance and filter transitions (#328).
 *
 * Two pieces live here so a single import covers the dashboard's animated
 * appearance needs:
 *   - <FadeIn>: a fade + small slide-up on mount. Wraps one widget.
 *   - <StaggerContainer>: a parent for <FadeIn> children that adds
 *     staggerChildren, so widgets enter one after another instead of all at
 *     once.
 *
 * Both respect `prefers-reduced-motion`: framer-motion's `useReducedMotion`
 * collapses the animations to an instant render for anyone who has asked the
 * OS to minimise motion. The components stay mounted and the layout is
 * identical — only the entry choreography is shortened.
 *
 * Scope kept narrow: chart transitions and micro-interactions are wired
 * directly in their own components because the timing differs (Recharts
 * already animates on data swap; modals have their own open/close motion).
 */

import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";

interface FadeInProps {
  children: ReactNode;
  /** Delay before this child enters, expressed in seconds. */
  delay?: number;
  className?: string;
}

/** Fade + slide-up entrance for one widget. */
export function FadeIn({ children, delay = 0, className }: FadeInProps) {
  const prefersReducedMotion = useReducedMotion();

  // Reduced motion: skip the entry animation entirely. The child appears at
  // its final position with no opacity dive.
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.35, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface StaggerContainerProps {
  children: ReactNode;
  /** Delay between each child entrance, expressed in seconds. */
  stagger?: number;
  /** Delay before the first child enters. */
  initialDelay?: number;
  className?: string;
}

/** Parent for <FadeIn> children — adds staggered entrance timing. */
export function StaggerContainer({
  children,
  stagger = 0.08,
  initialDelay = 0,
  className,
}: StaggerContainerProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: stagger,
            delayChildren: initialDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
