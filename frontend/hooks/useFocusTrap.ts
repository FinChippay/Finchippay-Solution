import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

interface UseFocusTrapOptions {
  /** Whether the trap is currently active (e.g. modal is open). */
  active: boolean;
  /** Called when the user presses Escape while the trap is active. */
  onEscape?: () => void;
  /** Element to focus when the trap activates. Defaults to the first focusable child. */
  initialFocusRef?: RefObject<HTMLElement>;
}

/**
 * Traps keyboard focus within `containerRef` while `active` is true: Tab/Shift+Tab
 * cycle within the focusable elements instead of escaping to the page, initial
 * focus moves into the container, and focus is restored to the previously
 * focused element when the trap deactivates (WCAG 2.1 SC 2.4.3, 2.1.2).
 */
export function useFocusTrap<T extends HTMLElement>(
  { active, onEscape, initialFocusRef }: UseFocusTrapOptions
): RefObject<T> {
  const containerRef = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (container) {
      const focusable = getFocusable(container);
      (initialFocusRef?.current ?? focusable[0] ?? container).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }
      if (e.key !== "Tab" || !container) return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (!container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [active, onEscape, initialFocusRef]);

  return containerRef;
}

export default useFocusTrap;
