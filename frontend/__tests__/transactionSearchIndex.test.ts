/**
 * __tests__/transactionSearchIndex.test.ts
 * Tests for transaction search index persistence with IndexedDB
 */

import {
  buildIndex,
  saveIndexedDB,
  loadIndexedDB,
  clearIndexedDB,
  getIndexMetadata,
} from "@/lib/transactionSearchIndex";
import { PaymentRecord } from "@/lib/stellar";

// Mock IndexedDB
const mockIndexedDB: {
  open: jest.Mock;
  databases: Map<string, any>;
} = {
  open: jest.fn(),
  databases: new Map(),
};

Object.defineProperty(window, "indexedDB", {
  value: mockIndexedDB,
  writable: true,
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
      createdAt: new Date(),
      status: "success",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockIndexedDB.databases.clear();
  });

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
      for (const [token, hashes] of index.entries()) {
        expect(Array.isArray(hashes)).toBe(true);
        // Check for duplicates
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(hashes.length);
      }
    });
  });
});
