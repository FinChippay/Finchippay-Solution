/**
 * components/VirtualizedList.tsx
 * Lightweight dependency-free virtualizer for long, monotonic lists.
 *
 * Only the rows overlapping the viewport (+ overscan) are mounted in the DOM,
 * so accounts with thousands of transactions stay smooth and memory-light.
 *
 * The list participates in normal page scrolling: the component measures its
 * position against `window` and absolutely positions rows inside a tall
 * spacer. This preserves the existing page-scroll + infinite-scroll UX.
 *
 * Accessibility:
 *  - The list is an ARIA `list` labelled with `listLabel`.
 *  - Every mounted row carries `aria-posinset` / `aria-setsize`, so screen
 *    readers announce the true position within the full list even though its
 *    siblings are not in the DOM.
 *  - A visually hidden `role="status"` (polite `aria-live`) region announces
 *    the visible range and total count so SR users know how much of the list
 *    is shown.
 *  - Keyboard focus: the focused row is always forced into the window, so
 *    roving-tabindex navigation (see parent) never points at an unmounted row.
 */

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface VirtualListRange {
  startIndex: number;
  endIndex: number;
}

const DEFAULT_ROW_HEIGHT = 76;
const DEFAULT_ROW_GAP = 8;
const DEFAULT_OVERSCAN = 6;

/**
 * Pure window computation — unit-testable without a DOM. Returns the inclusive
 * `[startIndex, endIndex)` window of rows that must be mounted.
 *
 * `scrollOffset` is the distance (px) from the top of the list to the top of
 * the viewport; `viewportHeight` is the height of the visible region.
 */
export function getVisibleRange(params: {
  total: number;
  scrollTop: number;
  viewportHeight: number;
  itemStride: number;
  overscan: number;
}): VirtualListRange {
  const { total, scrollTop, viewportHeight, itemStride, overscan } = params;
  if (total <= 0 || itemStride <= 0) return { startIndex: 0, endIndex: 0 };

  const safeScroll = Math.max(0, scrollTop);
  const safeViewport = Math.max(0, viewportHeight);

  const startIndex = Math.max(0, Math.floor(safeScroll / itemStride) - overscan);
  const endIndex = Math.min(total, Math.ceil((safeScroll + safeViewport) / itemStride) + overscan);
  return {
    startIndex: Math.min(startIndex, total),
    endIndex: Math.max(endIndex, startIndex),
  };
}

interface VirtualizedListProps<T> {
  /** Full, ordered dataset. Only a window of it is rendered. */
  items: T[];
  /** Fixed height (px) of a single row. */
  itemHeight?: number;
  /** Vertical gap (px) between rows. */
  rowGap?: number;
  /** Extra rows to keep mounted above/below the viewport. */
  overscan?: number;
  /** ARIA label describing the list contents. */
  listLabel: string;
  /** Prefix used in the polite live region announcement. */
  liveLabelPrefix?: string;
  className?: string;
  renderItem: (item: T, index: number) => React.ReactElement;
  itemKey: (item: T, index: number) => string;
  /** Keep this row inside the window so it stays focusable/renderable. */
  focusedIndex?: number;
  /** Called whenever the mounted window shifts. */
  onVisibleRangeChange?: (range: VirtualListRange) => void;
  /** Number of ridgeless rows above the list (header/etc.) to ignore. */
  topSpacerOffset?: number;
}

/** Offset reserved for the sticky header so the live region is meaningful. */
export function computeScrollOffset(params: {
  viewportScrollY: number;
  containerRectTop: number;
}): number {
  const { viewportScrollY, containerRectTop } = params;
  // Document position of the list's top edge.
  const containerDocTop = containerRectTop + viewportScrollY;
  const posInViewport = viewportScrollY - containerDocTop; // == -containerRectTop
  return Math.max(0, posInViewport);
}

export default function VirtualizedList<T>({
  items,
  itemHeight = DEFAULT_ROW_HEIGHT,
  rowGap = DEFAULT_ROW_GAP,
  overscan = DEFAULT_OVERSCAN,
  listLabel,
  liveLabelPrefix = "Transactions",
  className,
  renderItem,
  itemKey,
  focusedIndex,
  onVisibleRangeChange,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{
    scrollTop: number;
    viewportHeight: number;
  }>(() => ({
    scrollTop: 0,
    viewportHeight:
      typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 600,
  }));

  const stride = itemHeight + rowGap;
  const total = items.length;
  const totalHeight = Math.max(total * stride - (total > 0 ? rowGap : 0), 0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = Math.max(240, typeof window !== "undefined" ? window.innerHeight : 600);
    const scrollTop = computeScrollOffset({
      viewportScrollY: window.scrollY,
      containerRectTop: rect.top,
    });
    setViewport({ scrollTop, viewportHeight });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const rawRange = useMemo(
    () =>
      getVisibleRange({
        total,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.viewportHeight,
        itemStride: stride,
        overscan,
      }),
    [total, viewport.scrollTop, viewport.viewportHeight, stride, overscan],
  );

  // Expand the window so the focused row (roving tabindex) stays mounted.
  const winRange = useMemo(() => {
    const base = rawRange;
    if (
      focusedIndex == null ||
      focusedIndex < 0 ||
      total === 0 ||
      (focusedIndex >= base.startIndex && focusedIndex < base.endIndex)
    ) {
      return base;
    }
    const extent = Math.max(base.endIndex - base.startIndex, 1);
    if (focusedIndex < base.startIndex) {
      return {
        startIndex: focusedIndex,
        endIndex: Math.min(total, focusedIndex + extent),
      };
    }
    return {
      startIndex: Math.max(0, focusedIndex - extent + 1),
      endIndex: focusedIndex + 1,
    };
  }, [rawRange, focusedIndex, total]);

  const visibleIndexes = useMemo(() => {
    const out: number[] = [];
    for (let i = winRange.startIndex; i < winRange.endIndex; i++) out.push(i);
    return out;
  }, [winRange.startIndex, winRange.endIndex]);

  // Report the mounted window (used for the live region + tests).
  useEffect(() => {
    onVisibleRangeChange?.(winRange);
  }, [winRange, onVisibleRangeChange]);

  // Scroll the focused row into view when keyboard navigation moves it outside
  // the visible region.
  useEffect(() => {
    if (focusedIndex == null || focusedIndex < 0 || typeof window === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const containerDocTop = el.getBoundingClientRect().top + window.scrollY;
    const targetTop = containerDocTop + focusedIndex * stride;
    const targetBottom = targetTop + itemHeight;
    const visibleTop = window.scrollY;
    const visibleBottom = window.scrollY + window.innerHeight;
    if (targetTop < visibleTop) {
      window.scrollTo({ top: Math.max(0, targetTop - 16), behavior: "smooth" });
    } else if (targetBottom > visibleBottom) {
      window.scrollTo({
        top: targetBottom - window.innerHeight + 16,
        behavior: "smooth",
      });
    }
  }, [focusedIndex, stride, itemHeight]);

  const liveMessage =
    total === 0
      ? `${liveLabelPrefix}: none.`
      : `${liveLabelPrefix} ${winRange.startIndex + 1} through ${winRange.endIndex} of ${total}.`;

  return (
    <div
      className={clsx("relative", className)}
      ref={containerRef}
      role="list"
      aria-label={listLabel}
      data-virtualized-list=""
      style={{ height: totalHeight, position: "relative" }}
    >
      {visibleIndexes.map((index) => {
        const item = items[index];
        return (
          <div
            key={itemKey(item, index)}
            role="listitem"
            aria-posinset={index + 1}
            aria-setsize={total}
            data-virtual-row=""
            style={{
              position: "absolute",
              top: index * stride,
              left: 0,
              right: 0,
              height: itemHeight,
            }}
          >
            {renderItem(item, index)}
          </div>
        );
      })}
      <div role="status" aria-live="polite" className="sr-only" data-virtualized-live="">
        {liveMessage}
      </div>
    </div>
  );
}
