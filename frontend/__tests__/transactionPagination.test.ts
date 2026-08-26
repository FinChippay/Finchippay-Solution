/**
 * __tests__/transactionPagination.test.ts
 * Performance + correctness tests for the virtualized, cursor-paginated
 * transaction list:
 *
 *  1. Cursor pagination must never skip or duplicate rows, even when new
 *     transactions arrive at the head of the dataset between page requests.
 *  2. The list must only mount the visible window (virtualization), verified
 *     against synthetic datasets of >= 10k rows.
 *  3. Filters/search keep working across paginated pages.
 *  4. Window computations and renders stay cheap for large datasets.
 */

import { render, within } from "@testing-library/react";
import { createElement } from "react";
import VirtualizedList, {
  getVisibleRange,
  computeScrollOffset,
} from "@/components/VirtualizedList";
import {
  encodeCursor,
  decodeCursor,
  readCursorFromQuery,
  updateCursorInUrl,
  dedupeById,
  mergeRecordPages,
  prependNewestUnique,
  cursorSlice,
  CURSOR_QUERY_KEY,
} from "@/lib/api";
import { PaymentRecord } from "@/lib/stellar";
import { searchPayments, parseSearchQuery } from "@/lib/transactionSearch";

// ─── Synthetic dataset helpers ───────────────────────────────────────────────

export type Synthetic = PaymentRecord & {
  pagingToken: string;
  /** Legacy field still read by transactionSearch at runtime. */
  hash: string;
};

/** Build a newest-first dataset of `count` payments with sequential ids. */
function buildDataset(count: number, idOffset = 0) {
  const records: Synthetic[] = [];
  for (let i = 0; i < count; i++) {
    // Most recent first, so `i` grows as the history gets older.
    records.push({
      id: `op-${idOffset + i}`,
      type: i % 3 === 0 ? "sent" : "received",
      amount: `${(i % 400) + 0.5}`,
      asset: "XLM:GBSTRUSD",
      from: `GACCOUNTFROM00000000000000000000000000000000000000${i.toString(36)}`,
      to: `GACCOUNTTO000000000000000000000000000000000000000000${i.toString(36)}`,
      memo: i % 10 === 0 ? `payroll-${i}` : `memo-${i}`,
      hash: `hash${i}`.slice(0, 64),
      createdAt: new Date(2026, 0, 1, 0, 0, Math.max(1, count - i)).toISOString(),
      transactionHash: `abc123def456ghi789${i.toString(36)}${i}`,
      pagingToken: `1000000-${count - i}`,
    });
  }
  return records;
}

/** Extract a `cursor=` param from a URL string (helper for assertions). */
function readCursorFromUrl(url: string): string {
  const match = url.match(new RegExp(`[?&]${CURSOR_QUERY_KEY}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

// ─── Cursor pagination correctness ───────────────────────────────────────────

describe("cursor pagination — skip & duplicate safety", () => {
  it("paginates a full dataset with no skipped or duplicated rows", () => {
    const dataset = buildDataset(100);
    const limit = 10;
    const seenIds: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = cursorSlice(dataset, limit, cursor);
      if (page.records.length === 0) break;
      seenIds.push(...page.records.map((r) => r.id));
      pages += 1;
      if (page.nextCursor == null) break;
      cursor = page.nextCursor;
    }

    expect(pages).toBe(10);
    expect(new Set(seenIds).size).toBe(100);
    expect(seenIds).toEqual(dataset.map((r) => r.id));
  });

  it("does not skip or duplicate older rows when new transactions arrive mid-pagination", () => {
    const dataset = buildDataset(100);
    const limit = 10;

    const page1 = cursorSlice(dataset, limit);
    expect(page1.records).toHaveLength(10);
    const cursorAfterPage1 = page1.nextCursor;

    const page2 = cursorSlice(dataset, limit, cursorAfterPage1);
    expect(page2.records.map((r) => r.id)).toEqual([
      "op-10",
      "op-11",
      "op-12",
      "op-13",
      "op-14",
      "op-15",
      "op-16",
      "op-17",
      "op-18",
      "op-19",
    ]);

    // Five brand-new payments land at the head of the history.
    const withNewData = [...buildDataset(5), ...dataset];
    const page3 = cursorSlice(withNewData, limit, page2.nextCursor);

    // Oldest boundary records still advance one clean page — no overlap with
    // page2 (no duplicates) and nothing older skipped.
    expect(page3.records.map((r) => r.id)).toEqual([
      "op-20",
      "op-21",
      "op-22",
      "op-23",
      "op-24",
      "op-25",
      "op-26",
      "op-27",
      "op-28",
      "op-29",
    ]);
    expect(page3.nextCursor).toBe(dataset[29].pagingToken);
  });

  it("mergeRecordPages deduplicates overlapping pages from a shifting backend", () => {
    const dataset = buildDataset(20);
    const page1 = cursorSlice(dataset, 10).records;
    // Simulate Horizon returning a page whose head overlaps page1's tail.
    const overlapping = [dataset[9], ...dataset.slice(10, 18)];
    const merged = mergeRecordPages(page1, overlapping);
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
    expect(merged.length).toBe(18);
    // Order is stable: everything loaded keeps its first-seen position.
    expect(merged[0].id).toBe(page1[0].id);
    expect(merged[merged.length - 1].id).toBe(overlapping[overlapping.length - 1].id);
  });

  it("prependNewestUnique folds fresh records in without duplicating loaded ones", () => {
    const existing = cursorSlice(buildDataset(50), 20).records;
    const fresh = buildDataset(5, 100); // brand-new ids that must not collide
    const merged = prependNewestUnique(existing, fresh);
    expect(merged.slice(0, 5).map((r) => r.id)).toEqual(fresh.map((r) => r.id));
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
    // Everything previously loaded is still present exactly once.
    expect(merged.length).toBe(5 + existing.length);
  });

  it("reacts gracefully when the cursor no longer exists (records trimmed)", () => {
    const dataset = buildDataset(30);
    const stale = cursorSlice(dataset, 10, "1000000-999999");
    expect(stale.records).toHaveLength(0);
    expect(stale.nextCursor).toBeUndefined();
    expect(stale.hasMore).toBe(false);
  });

  it("cursor encoders round-trip and stay URL-safe", () => {
    const raw = "1234567-890:ABCDEF special/characters=+";
    const encoded = encodeCursor(raw);
    expect(encoded).not.toBe(raw);
    expect(encoded).not.toMatch(/[+/=]/); // base64url alphabet only
    expect(decodeCursor(encoded)).toBe(raw);

    const url = updateCursorInUrl("/transactions?direction=sent&limit=20", raw);
    expect(readCursorFromUrl(url)).toBe(encoded);
    expect(readCursorFromQuery(new URLSearchParams(new URL(url, "http://x").search))).toBe(raw);
    expect(readCursorFromQuery(url.split("?")[1] ?? "")).toBe(raw);
  });

  it("updateCursorInUrl removes the cursor without dropping other params", () => {
    const url = "/transactions?cursor=cGF5bG9hZP0&direction=sent";
    expect(updateCursorInUrl(url, undefined)).toBe("/transactions?direction=sent");
    expect(updateCursorInUrl("/transactions", undefined)).toBe("/transactions");
  });

  it("readCursorFromQuery understands string, URLSearchParams and object sources", () => {
    const raw = "tob";
    const encoded = encodeCursor(raw);
    expect(readCursorFromQuery(`cursor=${encoded}&x=1`)).toBe(raw);
    expect(readCursorFromQuery(new URLSearchParams(`cursor=${encoded}`))).toBe(raw);
    expect(readCursorFromQuery({ [CURSOR_QUERY_KEY]: encoded })).toBe(raw);
    expect(readCursorFromQuery({ [CURSOR_QUERY_KEY]: [encoded] })).toBe(raw);
    expect(readCursorFromQuery({ foo: "bar" })).toBeUndefined();
    expect(readCursorFromQuery(null)).toBeUndefined();
  });

  it("dedupeById is stable and preserves first-seen order", () => {
    const rows = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "a", v: 3 },
      { id: "c", v: 4 },
    ];
    expect(dedupeById(rows).map((r) => [r.id, r.v])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 4],
    ]);
  });
});

// ─── Virtualization: only the visible window is mounted ──────────────────────

describe("virtualized list windowing", () => {
  const stride = 76 + 8; // itemHeight + rowGap

  it("mounts only a small window for a 10k-row dataset", () => {
    const dataset = buildDataset(10_000);

    const range = getVisibleRange({
      total: dataset.length,
      scrollTop: 0,
      viewportHeight: 800,
      itemStride: stride,
      overscan: 6,
    });
    expect(range.startIndex).toBe(0);
    // Real visible rows (800 / 84 ≈ 10) plus overscan — nowhere near 10k.
    expect(range.endIndex).toBeLessThan(50);

    const deep = getVisibleRange({
      total: dataset.length,
      scrollTop: 8_000 * stride,
      viewportHeight: 800,
      itemStride: stride,
      overscan: 6,
    });
    expect(deep.startIndex).toBeGreaterThanOrEqual(7_990);
    expect(deep.startIndex).toBeLessThanOrEqual(8_000);
    expect(deep.endIndex - deep.startIndex).toBeLessThan(50);
  });

  it("renders 10k rows with a bounded DOM size and correct ARIA", () => {
    const dataset = buildDataset(10_000);
    const start = performance.now();
    const { container } = render(
      createElement(VirtualizedList<PaymentRecord> as never, {
        items: dataset as PaymentRecord[],
        itemHeight: 76,
        rowGap: 8,
        listLabel: "Payment history",
        itemKey: (tx: PaymentRecord) => tx.id,
        renderItem: (tx: PaymentRecord) => createElement("div", null, tx.id),
      }),
    );
    const renderTime = performance.now() - start;

    const list = within(container as HTMLElement).getByRole("list");
    expect(list).toHaveAttribute("aria-label", "Payment history");

    const mounted = container.querySelectorAll("[data-virtual-row]");
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100); // window + overscan only

    // Every mounted row advertises its true position in the full dataset.
    mounted.forEach((row) => {
      expect(row).toHaveAttribute("aria-setsize", "10000");
      expect(Number(row.getAttribute("aria-posinset"))).toBeGreaterThan(0);
    });

    // Polite live region announces the visible range of the full list.
    const live = container.querySelector("[data-virtualized-live]");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live?.textContent).toContain("of 10000");

    // Rendering 10k rows must stay cheap.
    expect(renderTime).toBeLessThan(3000);
  });

  it("keeps the focused row mounted so keyboard nav never targets a stale row", () => {
    const dataset = buildDataset(10_000);
    const { container } = render(
      createElement(VirtualizedList<PaymentRecord> as never, {
        items: dataset as PaymentRecord[],
        itemHeight: 76,
        rowGap: 8,
        listLabel: "Payment history",
        itemKey: (tx: PaymentRecord) => tx.id,
        renderItem: (tx: PaymentRecord) => createElement("div", null, tx.id),
        focusedIndex: 9_000,
      }),
    );
    const mounted = container.querySelectorAll("[data-virtual-row]");
    expect(mounted.length).toBeLessThan(100);
    const positions = Array.from(mounted).map((row) => Number(row.getAttribute("aria-posinset")));
    expect(positions).toContain(9_000);
  });

  it("viewport scroll offset computation matches browser geometry", () => {
    // List top scrolled 200px above the viewport top → offset is 200.
    expect(computeScrollOffset({ viewportScrollY: 500, containerRectTop: -200 })).toBe(200);
    // List still below the fold → offset clamps to 0.
    expect(computeScrollOffset({ viewportScrollY: 100, containerRectTop: 400 })).toBe(0);
  });
});

// ─── Filters & search across paginated pages ─────────────────────────────────

describe("filters and search across paginated pages", () => {
  it("search still finds a transaction that lives on a later page", () => {
    const dataset = buildDataset(500);
    const page1 = cursorSlice(dataset, 20).records;
    const page2 = cursorSlice(dataset, 20, "1000000-480").records;
    const merged = mergeRecordPages(page1, page2);

    // Force a unique candidate later in history so the match only exists once
    // both pages have been loaded.
    const target = { ...dataset[50], memo: "waldo-42" };
    const mergedWithTarget = mergeRecordPages(merged, [target]);

    const results = searchPayments(mergedWithTarget, "waldo-42");
    expect(results).toHaveLength(1);
    expect(results[0].payment.id).toBe(target.id);
    expect(parseSearchQuery("waldo-42").text).toBe("waldo-42");
  });

  it("operator-based filtering applies across merged pages", () => {
    const dataset = buildDataset(300);
    const pages = [cursorSlice(dataset, 20), cursorSlice(dataset, 20, "1000000-280")];
    const records = pages.reduce(
      (acc, page) => mergeRecordPages(acc, page.records),
      [] as PaymentRecord[],
    );

    // dataset[30] only appears on the second page (records 21..40), so a
    // match proves operator filters apply across merged cursor pages.
    const target = dataset[30];
    const results = searchPayments(records, `amount:${target.amount}`);
    expect(results).toHaveLength(1);
    expect(results[0].payment.id).toBe(target.id);
    results.forEach((r) => {
      expect(parseFloat(r.payment.amount)).toBe(parseFloat(target.amount));
    });
  });
});

// ─── Performance assertions for large datasets ───────────────────────────────

describe("performance on large synthetic datasets", () => {
  it("computes windows instantly for 50k+ rows", () => {
    const dataset = buildDataset(50_000);
    const start = performance.now();
    let last = { startIndex: 0, endIndex: 0 };
    // Simulate a scroll through the whole history.
    for (let i = 0; i < 500; i++) {
      last = getVisibleRange({
        total: dataset.length,
        scrollTop: i * 5 * 84,
        viewportHeight: 800,
        itemStride: 84,
        overscan: 6,
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(last.endIndex).toBeLessThanOrEqual(dataset.length);
  });

  it("is resilient with an empty dataset and degenerate inputs", () => {
    expect(
      getVisibleRange({
        total: 0,
        scrollTop: 0,
        viewportHeight: 800,
        itemStride: 84,
        overscan: 6,
      }),
    ).toEqual({ startIndex: 0, endIndex: 0 });
    expect(cursorSlice([], 20)).toEqual({
      records: [],
      nextCursor: undefined,
      hasMore: false,
    });
    // Limit 0 degrades to a minimum of 1 rather than throwing.
    expect(cursorSlice(buildDataset(5), 0).records).toHaveLength(1);
  });
});
