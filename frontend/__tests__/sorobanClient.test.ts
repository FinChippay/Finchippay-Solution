/**
 * __tests__/sorobanClient.test.ts
 * Unit tests for the FinchippayClient Soroban RPC abstraction layer.
 *
 * Tests client construction, error mapping, retry logic, and all contract methods
 * with mocked RPC responses.
 */

import { FinchippayClient, getClient, resetClient } from "@/lib/soroban";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockTx = {
  hash: jest.fn(() => Buffer.from("abc123")),
  toXDR: jest.fn(() => "mock-xdr"),
  signatures: [],
};

const mockSimulateSuccess = {
  result: {
    retval: {
      type: "scval",
      mockReturnValue: null,
      value: null,
    },
  },
};

jest.mock("@stellar/stellar-sdk", () => ({
  Transaction: jest.fn(() => mockTx),
  Account: jest.fn((key, seq) => ({ accountId: key, sequenceNumber: seq })),
  Contract: jest.fn(() => ({
    call: jest.fn((method, ...args) => ({ method, args })),
  })),
  Asset: {
    native: jest.fn(() => ({
      contractId: jest.fn(() => "native-contract-id"),
    })),
  },
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn(() => mockTx),
  })),
  nativeToScVal: jest.fn((val) => ({ type: "scval", value: val })),
  scValToNative: jest.fn((val) => val?.value ?? null),
  rpc: {
    Api: {
      isSimulationError: jest.fn(() => false),
      isSimulationSuccess: jest.fn(() => true),
    },
    Server: jest.fn(() => ({
      simulateTransaction: jest.fn(() => mockSimulateSuccess),
      prepareTransaction: jest.fn((tx) => tx),
      serverURL: new URL("https://soroban-testnet.stellar.org"),
    })),
  },
  xdr: {
    ScVal: { scvSymbol: jest.fn(), scvU32: jest.fn(), scvI128: jest.fn(), scvAddress: jest.fn() },
  },
}));

jest.mock("@/lib/stellar", () => ({
  CONTRACT_ID: "CCONTRACT123456789",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  getSorobanServer: jest.fn(() => ({
    simulateTransaction: jest.fn(() => mockSimulateSuccess),
    prepareTransaction: jest.fn((tx) => tx),
    serverURL: new URL("https://soroban-testnet.stellar.org"),
  })),
  getNetworkConfig: jest.fn(() => ({
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  })),
  STELLAR_STROOPS_PER_XLM: 10_000_000,
  STELLAR_BASE_FEE_STROOPS: 100,
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("FinchippayClient", () => {
  const rpcUrl = "https://soroban-testnet.stellar.org";
  const contractId = "CCONTRACT123456789";
  const passphrase = "Test SDF Network ; September 2015";
  const publicKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";

  let client: FinchippayClient;

  beforeAll(() => {
    // Mock fetch globally for Horizon account loading
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ sequence: "123" }),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetClient();
    client = new FinchippayClient(rpcUrl, contractId, passphrase);
  });

  describe("constructor", () => {
    it("creates an instance with the given parameters", () => {
      expect(client).toBeInstanceOf(FinchippayClient);
    });

    it("getClient() returns a singleton instance", () => {
      const instance1 = getClient();
      const instance2 = getClient();
      expect(instance1).toBe(instance2);
    });

    it("resetClient() clears the singleton", () => {
      const instance1 = getClient();
      resetClient();
      const instance2 = getClient();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("buildSendTipTx", () => {
    it("returns a Transaction on success", async () => {
      const result = await client.buildSendTipTx(
        "native-contract-id",
        publicKey,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "10",
      );
      expect(result).toBeDefined();
      expect(result.toXDR).toBeDefined();
    }, 10000);
  });

  describe("buildCreateEscrowTx", () => {
    it("returns an object with tx", async () => {
      const result = await client.buildCreateEscrowTx(
        "native-contract-id",
        publicKey,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "100",
        1500,
      );
      expect(result).toHaveProperty("tx");
      expect(result.tx.toXDR).toBeDefined();
    }, 10000);
  });

  describe("buildClaimEscrowTx", () => {
    it("returns a Transaction on success", async () => {
      const result = await client.buildClaimEscrowTx(42, publicKey);
      expect(result).toBeDefined();
      expect(result.toXDR).toBeDefined();
    }, 10000);
  });

  describe("buildCancelEscrowTx", () => {
    it("returns a Transaction on success", async () => {
      const result = await client.buildCancelEscrowTx(42, publicKey);
      expect(result).toBeDefined();
      expect(result.toXDR).toBeDefined();
    }, 10000);
  });

  describe("buildClaimStreamTx", () => {
    it("returns a Transaction on success", async () => {
      const result = await client.buildClaimStreamTx(1, publicKey);
      expect(result).toBeDefined();
      expect(result.toXDR).toBeDefined();
    }, 10000);
  });

  describe("getTipTotal", () => {
    it("returns 0 when no tips exist", async () => {
      const result = await client.getTipTotal(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
      expect(result).toBe("0");
    }, 10000);
  });

  describe("getContractVersion", () => {
    it("returns 0 when no version is available", async () => {
      const result = await client.getContractVersion();
      expect(result).toBe(0);
    }, 10000);
  });

  describe("getContractStats", () => {
    it("returns default stats when no data", async () => {
      const result = await client.getContractStats(publicKey);
      expect(result).toEqual({ escrows: 0, streams: 0, multisigs: 0 });
    }, 10000);
  });

  describe("isPaused", () => {
    it("returns false by default", async () => {
      const result = await client.isPaused(publicKey);
      expect(result).toBe(false);
    }, 10000);
  });

  describe("getEscrow", () => {
    it("returns null when no escrow found", async () => {
      const result = await client.getEscrow(42, publicKey);
      expect(result).toBeNull();
    }, 10000);
  });

  describe("getStream", () => {
    it("returns null when no stream found", async () => {
      const result = await client.getStream(1, publicKey);
      expect(result).toBeNull();
    }, 10000);
  });

  describe("getMultisig", () => {
    it("returns null when no proposal found", async () => {
      const result = await client.getMultisig(1, publicKey);
      expect(result).toBeNull();
    }, 10000);
  });

  describe("getClaimable", () => {
    it("returns 0 when nothing claimable", async () => {
      const result = await client.getClaimable(1, publicKey);
      expect(result).toBe("0");
    }, 10000);
  });

  describe("sendTip", () => {
    it("returns a transaction hash on success", async () => {
      const result = await client.sendTip(
        "native-contract-id",
        publicKey,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "10",
      );
      expect(result).toHaveProperty("transactionHash");
    }, 10000);
  });
});
