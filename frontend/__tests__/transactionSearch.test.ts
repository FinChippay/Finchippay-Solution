/**
 * __tests__/transactionSearch.test.ts
 * Tests for transaction search functionality
 */

import {
  parseSearchQuery,
  tokenizeText,
  matchesOperators,
  calculateRelevance,
  searchPayments,
} from "@/lib/transactionSearch";
import { PaymentRecord } from "@/lib/stellar";

describe("Transaction Search", () => {
  const mockPayments: PaymentRecord[] = [
    {
      id: "1",
      type: "payment",
      from: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
      to: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
      amount: "100.5",
      asset: "XLM:native",
      memo: "Payment for invoice #123",
      hash: "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
      createdAt: new Date("2026-01-15"),
      status: "success",
    },
    {
      id: "2",
      type: "payment_received",
      from: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
      to: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
      amount: "50",
      asset: "USDC:GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
      memo: "Salary deposit",
      hash: "zyx987wvu654tsr321qpo098nml765kji432hgf109edc876baz",
      createdAt: new Date("2026-01-14"),
      status: "success",
    },
    {
      id: "3",
      type: "payment",
      from: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
      to: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF46Q",
      amount: "250",
      asset: "XLM:native",
      memo: "",
      hash: "qqq123rrr456sss789ttt012uuu345vvv678www901xxx234yyy",
      createdAt: new Date("2026-01-10"),
      status: "success",
    },
  ];

  describe("parseSearchQuery", () => {
    it("should parse simple text query", () => {
      const result = parseSearchQuery("invoice");
      expect(result.text).toBe("invoice");
      expect(result.from).toBeUndefined();
    });

    it("should parse from: operator", () => {
      const result = parseSearchQuery("from:GA2C5RFPE");
      expect(result.from).toBe("GA2C5RFPE");
      expect(result.text).toBe("");
    });

    it("should parse multiple operators", () => {
      const result = parseSearchQuery("from:GXXX to:GYYY amount:>100");
      expect(result.from).toBe("GXXX");
      expect(result.to).toBe("GYYY");
      expect(result.amount).toBe(">100");
    });

    it("should parse asset operator", () => {
      const result = parseSearchQuery("asset:USDC");
      expect(result.asset).toBe("USDC");
    });

    it("should handle operators with text", () => {
      const result = parseSearchQuery("invoice from:GXXX");
      expect(result.text).toBe("invoice");
      expect(result.from).toBe("GXXX");
    });
  });

  describe("tokenizeText", () => {
    it("should tokenize simple text", () => {
      const tokens = tokenizeText("Payment for invoice");
      expect(tokens).toContain("payment");
      expect(tokens).toContain("for");
      expect(tokens).toContain("invoice");
    });

    it("should be case-insensitive", () => {
      const tokens = tokenizeText("Invoice PAYMENT");
      expect(tokens).toContain("invoice");
      expect(tokens).toContain("payment");
    });

    it("should handle punctuation", () => {
      const tokens = tokenizeText("Invoice #123");
      expect(tokens).toContain("invoice");
      expect(tokens).toContain("123");
    });

    it("should filter empty tokens", () => {
      const tokens = tokenizeText("  payment  ");
      expect(tokens).toEqual(["payment"]);
    });
  });

  describe("matchesOperators", () => {
    it("should match from: operator", () => {
      const result = matchesOperators(mockPayments[0], {
        from: "GA2C5RFPE",
      });
      expect(result).toBe(true);
    });

    it("should not match from: operator with wrong address", () => {
      const result = matchesOperators(mockPayments[0], {
        from: "GBXXXXXXX",
      });
      expect(result).toBe(false);
    });

    it("should match amount operators", () => {
      const result1 = matchesOperators(mockPayments[0], {
        amount: ">100",
      });
      expect(result1).toBe(true);

      const result2 = matchesOperators(mockPayments[0], {
        amount: "<200",
      });
      expect(result2).toBe(true);

      const result3 = matchesOperators(mockPayments[0], {
        amount: "100.5",
      });
      expect(result3).toBe(true);
    });

    it("should match asset operator", () => {
      const result = matchesOperators(mockPayments[0], {
        asset: "XLM",
      });
      expect(result).toBe(true);
    });

    it("should match multiple operators", () => {
      const result = matchesOperators(mockPayments[0], {
        from: "GA2C5RF",
        amount: ">50",
        asset: "XLM",
      });
      expect(result).toBe(true);
    });
  });

  describe("calculateRelevance", () => {
    it("should score exact memo matches highest", () => {
      const tokens = tokenizeText("Payment");
      const score = calculateRelevance(mockPayments[0], tokens);
      expect(score).toBeGreaterThan(0);
    });

    it("should score partial memo matches", () => {
      const tokens = tokenizeText("invoice");
      const score = calculateRelevance(mockPayments[0], tokens);
      expect(score).toBeGreaterThan(0);
    });

    it("should score hash prefix matches", () => {
      const tokens = ["abc"];
      const score = calculateRelevance(mockPayments[0], tokens);
      expect(score).toBeGreaterThan(0);
    });

    it("should return 0 for non-matching tokens", () => {
      const tokens = ["xyz123"];
      const score = calculateRelevance(mockPayments[0], tokens);
      expect(score).toBe(0);
    });
  });

  describe("searchPayments", () => {
    it("should return empty array for empty query", () => {
      const results = searchPayments(mockPayments, "");
      expect(results).toEqual([]);
    });

    it("should find payments by memo text", () => {
      const results = searchPayments(mockPayments, "invoice");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].payment.memo).toContain("invoice");
    });

    it("should find payments by address", () => {
      const results = searchPayments(mockPayments, "GA2C5RF");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find payments by hash prefix", () => {
      const results = searchPayments(mockPayments, "abc123");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should apply from: operator", () => {
      const results = searchPayments(mockPayments, "from:GA2C5RF");
      expect(results.length).toBe(2); // Two payments from this address
      expect(
        results.every((r) => r.payment.type === "payment" || r.payment.from === mockPayments[0].from)
      ).toBe(true);
    });

    it("should apply amount: operator", () => {
      const results = searchPayments(mockPayments, "amount:>100");
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.every((r) => parseFloat(r.payment.amount) > 100)
      ).toBe(true);
    });

    it("should sort results by relevance", () => {
      const results = searchPayments(mockPayments, "payment");
      if (results.length > 1) {
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].relevance).toBeGreaterThanOrEqual(
            results[i + 1].relevance
          );
        }
      }
    });

    it("should include highlights in results", () => {
      const results = searchPayments(mockPayments, "invoice");
      if (results.length > 0) {
        const result = results[0];
        expect(result.highlights).toBeDefined();
        expect(
          result.highlights.memo.length > 0 ||
            result.highlights.address.length > 0 ||
            result.highlights.hash.length > 0
        ).toBe(true);
      }
    });
  });
});
