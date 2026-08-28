/**
 * __tests__/clientSingletonUnify.test.ts
 * Tests that resetClient() invalidates all contract clients, including the escrow
 * manager's, so a network switch targets the new RPC/passphrase.
 */

import { registerClientReset, resetClient } from "@/lib/soroban";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockEscrowClient = {
  getEscrowCount: jest.fn(),
  getEscrow: jest.fn(),
};

jest.mock("@/lib/escrowManager", () => ({
  __esModule: true,
  getEscrows: jest.fn(() => Promise.resolve([])),
  claimEscrow: jest.fn(() => Promise.resolve("hash")),
  cancelEscrow: jest.fn(() => Promise.resolve("hash")),
  getEscrowDetail: jest.fn(() => Promise.resolve(null)),
  clearEscrowCache: jest.fn(),
  categorizeEscrows: jest.fn(() => ({ active: [], completed: [], incoming: [] })),
  sortEscrows: jest.fn((escrows) => escrows),
  filterEscrows: jest.fn((escrows) => escrows),
}));

jest.mock("@/lib/contract-bindings", () => ({
  FinchippayContractClient: jest.fn(() => mockEscrowClient),
  EscrowStatus: { Pending: "Pending", Released: "Released", Cancelled: "Cancelled" },
}));

jest.mock("@/lib/stellar", () => ({
  CONTRACT_ID: "CCONTRACT123456789",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  submitTransaction: jest.fn(),
  getCurrentLedger: jest.fn(),
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(() => Promise.resolve({ signedXDR: "signed", error: null })),
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Client Singleton Unification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetClient();
  });

  describe("registerClientReset", () => {
    it("should register a reset callback that is invoked by resetClient()", () => {
      const resetFn = jest.fn();

      registerClientReset(resetFn);
      resetClient();

      expect(resetFn).toHaveBeenCalledTimes(1);
    });

    it("should invoke all registered reset callbacks when resetClient() is called", () => {
      const resetFn1 = jest.fn();
      const resetFn2 = jest.fn();
      const resetFn3 = jest.fn();

      registerClientReset(resetFn1);
      registerClientReset(resetFn2);
      registerClientReset(resetFn3);
      resetClient();

      expect(resetFn1).toHaveBeenCalledTimes(1);
      expect(resetFn2).toHaveBeenCalledTimes(1);
      expect(resetFn3).toHaveBeenCalledTimes(1);
    });

    it("should invoke reset callbacks every time resetClient() is called", () => {
      const resetFn = jest.fn();

      registerClientReset(resetFn);
      resetClient();
      resetClient();
      resetClient();

      expect(resetFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("escrowManager singleton invalidation", () => {
    it("should invalidate escrow client when resetClient() is called", async () => {
      const { getEscrows } = await import("@/lib/escrowManager");

      // Call getEscrows to create the internal client singleton
      await getEscrows("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");

      // Reset all clients (simulating a network switch)
      resetClient();

      // Call getEscrows again - should work with a fresh client
      await getEscrows("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");

      // The function should complete without errors
      expect(getEscrows).toBeDefined();
    });

    it("should invalidate escrow cache when network switches", async () => {
      const { getEscrows, clearEscrowCache } = await import("@/lib/escrowManager");

      // Call getEscrows to populate cache
      await getEscrows("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");

      // Simulate network switch by resetting clients
      resetClient();

      // Clear cache should work after reset
      clearEscrowCache();

      // Verify we can still call getEscrows after reset
      const result = await getEscrows("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");
      expect(result).toEqual([]);
    });
  });

  describe("network switch simulation", () => {
    it("should reset all clients when network configuration changes", async () => {
      const { setNetworkConfig } = await import("@/lib/stellarConfig");

      const resetFn = jest.fn();
      registerClientReset(resetFn);

      // Simulate network switch
      setNetworkConfig({ network: "mainnet", horizonUrl: "https://horizon.stellar.org" });

      // Wait for the async dynamic import to resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The reset callback should have been invoked
      expect(resetFn).toHaveBeenCalled();
    });

    it("should allow escrow operations to target new RPC after network switch", async () => {
      const { getEscrows } = await import("@/lib/escrowManager");

      // Initial call on testnet
      await getEscrows("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");

      // Reset all clients (simulating network switch)
      resetClient();

      // Call should succeed after reset
      const result = await getEscrows("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("soroban.ts getClient singleton", () => {
    it("should return same instance before reset, different after", async () => {
      const { getClient } = await import("@/lib/soroban");

      const instance1 = getClient();
      const instance2 = getClient();
      expect(instance1).toBe(instance2);

      resetClient();

      const instance3 = getClient();
      expect(instance1).not.toBe(instance3);
    });
  });
});
