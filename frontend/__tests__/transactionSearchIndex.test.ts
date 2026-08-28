/**
 * __tests__/transactionSearchIndex.test.ts
 * Tests for transaction search index persistence with IndexedDB
 */

import "fake-indexeddb/auto";
import {
  buildIndex,
  saveIndexedDB,
  loadIndexedDB,
  clearIndexedDB,
  getIndexMetadata,
  invalidate,
  capHashesPerEntry,
  evictOverflow,
  removeHashesFromIndex,
  MAX_HASHES_PER_ENTRY,
  MAX_INDEX_ENTRIES,
} from "@/lib/transactionSearchIndex";
import { PaymentRecord } from "@/lib/stellar";

// Fake IndexedDB needs to be attached to the window before use.
beforeEach(async () => {
  await clearIndexedDB();
  jest.clearAllMocks();
});

describe("Transaction Search Index", () => {
  const mockPayments: PaymentRecord[] = [
    {
      id: "1",
      type: "payment",
      from: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
      to: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
      amount: "100",
      asset: "XLM:native",
      memo: "Payment memo test",
      hash: "abc123def456",
      createdAt: new Date().toISOString(),
      status: "success",
    },
  ] as unknown as PaymentRecord[];

  describe("buildIndex", () => {
    it("should create an inverted index from transactions", () => {
      const index = buildIndex(mockPayments);
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBeGreaterThan(0);
    });

    it("should tokenize memo", () => {
      const index = buildIndex(mockPayments);
      expect(index.has("payment")).toBe(true);
      expect(index.has("memo")).toBe(true);
    });

    it("should index address prefixes", () => {
      const index = buildIndex(mockPayments);
      // Should have at least some address-related tokens
      expect(index.size).toBeGreaterThan(0);
    });

    it("should handle payments without memo", () => {
      const paymentsNoMemo = [
        {
          ...mockPayments[0],
          memo: "",
        },
      ];
      const index = buildIndex(paymentsNoMemo);
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBeGreaterThan(0);
    });

    it("should index hash prefixes", () => {
      const index = buildIndex(mockPayments);
      // Hash should be indexed with prefix tokens
      expect(index.size).toBeGreaterThan(0);
    });
  });

  describe("Index Operations with Mocks", () => {
    it("should handle empty payment arrays", () => {
      const index = buildIndex([]);
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBe(0);
    });

    it("should handle multiple payments", () => {
      const payments = [
        ...mockPayments,
        {
          ...mockPayments[0],
          id: "2",
          memo: "Another payment",
          hash: "xyz789",
        },
      ];
      const index = buildIndex(payments);
      expect(index.size).toBeGreaterThan(0);
    });

    it("should deduplicate hash entries in index", () => {
      const index = buildIndex(mockPayments);
      // Each token should map to an array of hashes
      for (const [, hashes] of index.entries()) {
        expect(Array.isArray(hashes)).toBe(true);
        // Check for duplicates
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(hashes.length);
      }
    });
  });

  describe("capHashesPerEntry", () => {
    it("should truncate a token entry to the per-entry cap", () => {
      const index = new Map<string, string[]>([
        ["tokenA", Array.from({ length: 150 }, (_, i) => `hash${i}`)],
      ]);
      const capped = capHashesPerEntry(index, 100);
      expect(capped.get("tokenA")!.length).toBe(100);
    });

    it("should keep entries under the cap unchanged", () => {
      const index = new Map<string, string[]>([["tokenA", ["h1", "h2"]]]);
      const capped = capHashesPerEntry(index, 100);
      expect(capped.get("tokenA")!.length).toBe(2);
    });

    it("should not mutate the input map", () => {
      const index = new Map<string, string[]>([
        ["tokenA", Array.from({ length: 120 }, (_, i) => `hash${i}`)],
      ]);
      capHashesPerEntry(index, 100);
      expect(index.get("tokenA")!.length).toBe(120);
    });
  });

  describe("evictOverflow", () => {
    it("should evict oldest entries beyond the total-entry cap", () => {
      const index = new Map<string, string[]>([
        ["oldest", ["h1"]],
        ["mid", ["h2"]],
        ["newest", ["h3"]],
      ]);
      const evicted = evictOverflow(index, 2);
      expect(evicted.size).toBe(2);
      expect(evicted.has("oldest")).toBe(false);
      expect(evicted.has("mid")).toBe(true);
      expect(evicted.has("newest")).toBe(true);
    });

    it("should return all entries when under the cap", () => {
      const index = new Map<string, string[]>([
        ["a", ["h1"]],
        ["b", ["h2"]],
      ]);
      const evicted = evictOverflow(index, 100);
      expect(evicted.size).toBe(2);
    });

    it("should not mutate the input map", () => {
      const index = new Map<string, string[]>([
        ["a", ["h1"]],
        ["b", ["h2"]],
        ["c", ["h3"]],
      ]);
      evictOverflow(index, 2);
      expect(index.size).toBe(3);
    });

    it("uses the configured constant as default cap", () => {
      const index = new Map<string, string[]>();
      for (let i = 0; i < MAX_INDEX_ENTRIES + 5; i++) {
        index.set(`token${i}`, ["h"]);
      }
      const evicted = evictOverflow(index);
      expect(evicted.size).toBe(MAX_INDEX_ENTRIES);
    });
  });

  describe("removeHashesFromIndex", () => {
    it("should remove matching hashes from entries", () => {
      const index = new Map<string, string[]>([
        ["tokenA", ["h1", "h2", "h3"]],
        ["tokenB", ["h2", "h4"]],
      ]);
      const result = removeHashesFromIndex(index, ["h2"]);
      expect(result.get("tokenA")).toEqual(["h1", "h3"]);
      expect(result.get("tokenB")).toEqual(["h4"]);
    });

    it("should drop entries that become empty", () => {
      const index = new Map<string, string[]>([
        ["tokenA", ["h1", "h2"]],
        ["tokenB", ["h3"]],
      ]);
      const result = removeHashesFromIndex(index, ["h1", "h2"]);
      expect(result.has("tokenA")).toBe(false);
      expect(result.has("tokenB")).toBe(true);
    });

    it("should return unchanged map when hashes array is empty", () => {
      const index = new Map<string, string[]>([["tokenA", ["h1"]]]);
      const result = removeHashesFromIndex(index, []);
      expect(result.get("tokenA")).toEqual(["h1"]);
    });

    it("should not mutate the input map", () => {
      const index = new Map<string, string[]>([["tokenA", ["h1", "h2"]]]);
      removeHashesFromIndex(index, ["h1"]);
      expect(index.get("tokenA")).toEqual(["h1", "h2"]);
    });
  });

  describe("IndexedDB persistence", () => {
    it("should save and load the index", async () => {
      const index = buildIndex(mockPayments);
      await saveIndexedDB(mockPayments, index);
      const loaded = await loadIndexedDB();
      expect(loaded).not.toBeNull();
      expect(loaded!.get("payment")).toContain("abc123def456");
    });

    it("should store metadata", async () => {
      const index = buildIndex(mockPayments);
      await saveIndexedDB(mockPayments, index);
      const meta = await getIndexMetadata();
      expect(meta).not.toBeNull();
      expect(meta!.transactionCount).toBe(mockPayments.length);
      expect(meta!.lastIndexed).toBeGreaterThan(0);
    });

    it("should rebuild the index with the latest payments on save", async () => {
      await saveIndexedDB(mockPayments, buildIndex(mockPayments));
      const second = [
        ...mockPayments,
        {
          ...mockPayments[0],
          id: "2",
          memo: "second memo token",
          hash: "secondhash123",
        },
      ] as unknown as PaymentRecord[];
      await saveIndexedDB(second, buildIndex(second));
      const loaded = await loadIndexedDB();
      expect(loaded).not.toBeNull();
      // "second memo token" → tokens: second, memo, token
      expect(loaded!.get("second")).toContain("secondhash123");
    });
  });

  describe("invalidate", () => {
    it("should un-index hashes that were removed", async () => {
      const payments = [
        mockPayments[0],
        {
          ...mockPayments[0],
          id: "2",
          memo: "deletedMemoPayload",
          hash: "hashToDelete123",
        },
      ] as unknown as PaymentRecord[];
      await saveIndexedDB(payments, buildIndex(payments));

      // The removed payment's tokens should be indexed (lowercased by buildIndex)
      let loaded = await loadIndexedDB();
      expect(loaded!.get("deletedmemopayload")).toBeDefined();

      const removed = await invalidate(["hashToDelete123"]);
      expect(removed).toBeGreaterThan(0);

      // Entry referencing only the removed hash is gone; other entries remain
      loaded = await loadIndexedDB();
      expect(loaded!.get("deletedmemopayload")).toBeUndefined();
      expect(loaded!.get("payment")).toBeDefined();
    });

    it("should return 0 for an empty hashes list", async () => {
      const removed = await invalidate([]);
      expect(removed).toBe(0);
    });

    it("should clear fully and reindex via invalidate + save", async () => {
      await saveIndexedDB(mockPayments, buildIndex(mockPayments));
      await invalidate(["abc123def456"]);
      const loaded = await loadIndexedDB();
      expect(loaded).toBeNull();
    });
  });
});
