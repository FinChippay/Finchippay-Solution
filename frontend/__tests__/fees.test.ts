import type { Transaction } from "@stellar/stellar-sdk";
import {
  getFeeStats,
  estimateAccurateFee,
  estimateTransactionFee,
  getFeeForTier,
  formatFeeStroopsToXlm,
  resetFeeStatsCache,
} from "../lib/fees";
import { simulateTransactionResources } from "../lib/soroban";

jest.mock("../lib/soroban", () => ({ simulateTransactionResources: jest.fn() }));
jest.mock("../lib/stellar", () => ({
  getNetworkConfig: () => ({ horizonUrl: "https://horizon.example" }),
}));

const mockFeeStats = {
  min_accepted_fee: 100,
  fee_charged: {
    mode: 100,
    p50: 100,
    p95: 200,
    p99: 500,
  },
  last_ledger: 12345,
  max_fee: { max: 1000 },
};

describe("fees", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    globalThis.fetch = jest.fn();
    resetFeeStatsCache();
  });

  describe("getFeeStats", () => {
    it("fetches and returns fee stats from Horizon", async () => {
      jest.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFeeStats),
      } as Response);

      const stats = await getFeeStats();

      expect(stats.min).toBe(100);
      expect(stats.p50).toBe(100);
      expect(stats.p95).toBe(200);
      expect(stats.p99).toBe(500);
      expect(stats.max).toBe(1000);
    });

    it("caches fee stats for 60 seconds", async () => {
      const fetchMock = jest.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFeeStats),
      } as Response);
      global.fetch = fetchMock;

      await getFeeStats();
      await getFeeStats();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws on failed fetch", async () => {
      jest.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      } as Response);

      await expect(getFeeStats()).rejects.toThrow("Failed to fetch fee stats");
    });
  });

  describe("estimateAccurateFee", () => {
    const sorobanTx = {
      operations: [{ type: "invokeHostFunction" }, { type: "payment" }],
    } as unknown as Transaction;

    beforeEach(() => {
      jest.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockFeeStats,
      } as Response);
    });

    it("combines simulated resource fee and Horizon p95 base fee", async () => {
      jest.mocked(simulateTransactionResources).mockResolvedValue({
        cpuInstructions: 1234,
        readBytes: 200,
        writeBytes: 50,
        resourceFeeStroops: 5000,
      });
      const estimate = await estimateAccurateFee(sorobanTx);
      expect(estimate.totalFeeStroops).toBe(5400);
      expect(estimate.cpuInstructions).toBe(1234);
      expect(estimate.simulated).toBe(true);
    });

    it("surfaces Horizon min and max fees without a multiplier", async () => {
      jest.mocked(simulateTransactionResources).mockResolvedValue({
        cpuInstructions: 1,
        readBytes: 2,
        writeBytes: 3,
        resourceFeeStroops: 4,
      });
      const estimate = await estimateAccurateFee(sorobanTx);
      expect(estimate.minBaseFeeStroops).toBe(100);
      expect(estimate.maxBaseFeeStroops).toBe(1000);
    });

    it("uses a conservative estimate and warning when simulation fails", async () => {
      jest.mocked(simulateTransactionResources).mockRejectedValue(new Error("offline"));
      const estimate = await estimateAccurateFee(sorobanTx);
      expect(estimate.totalFeeStroops).toBe(1_002_000);
      expect(estimate.warning).toMatch(/conservative fallback/);
      expect(estimate.simulated).toBe(false);
    });

    it("does not simulate classic transactions", async () => {
      const classicTx = { operations: [{ type: "payment" }] } as unknown as Transaction;
      const estimate = await estimateAccurateFee(classicTx);
      expect(simulateTransactionResources).not.toHaveBeenCalled();
      expect(estimate.resourceFeeStroops).toBe(0);
      expect(estimate.totalFeeStroops).toBe(200);
    });
  });

  describe("estimateTransactionFee", () => {
    it("calculates fee for single operation", () => {
      const fee = estimateTransactionFee(1, 100);
      expect(parseFloat(fee)).toBe(0.00001);
    });

    it("calculates fee for multiple operations", () => {
      const fee = estimateTransactionFee(5, 200);
      expect(parseFloat(fee)).toBe(0.0001);
    });
  });

  describe("getFeeForTier", () => {
    it("returns p50 for economy tier", () => {
      const stats = { min: 100, mode: 100, p50: 100, p95: 200, p99: 500, lastLedger: 1, max: 1000 };
      expect(getFeeForTier(stats, "economy")).toBe(100);
    });

    it("returns p95 for standard tier", () => {
      const stats = { min: 100, mode: 100, p50: 100, p95: 200, p99: 500, lastLedger: 1, max: 1000 };
      expect(getFeeForTier(stats, "standard")).toBe(200);
    });

    it("returns p99 for priority tier", () => {
      const stats = { min: 100, mode: 100, p50: 100, p95: 200, p99: 500, lastLedger: 1, max: 1000 };
      expect(getFeeForTier(stats, "priority")).toBe(500);
    });
  });

  describe("formatFeeStroopsToXlm", () => {
    it("formats stroops to XLM with 7 decimal places", () => {
      expect(formatFeeStroopsToXlm(100)).toBe("0.0000100");
      expect(formatFeeStroopsToXlm(10000000)).toBe("1.0000000");
    });
  });
});
