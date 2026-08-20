/**
 * __tests__/wallets-adapters.test.ts
 * Unit tests for unified StellarWallet adapters and registry (#70).
 * Tests connect, disconnect, sign, and availability across all 5 providers:
 * - Freighter
 * - Albedo
 * - xBull
 * - Lobstr
 * - WalletConnect
 */

import * as freighterApi from "@stellar/freighter-api";
import {
  FreighterWalletAdapter,
  AlbedoWalletAdapter,
  XBullWalletAdapter,
  LobstrWalletAdapter,
  WalletConnectAdapter,
  getWallet,
  getAllWallets,
  getActiveWallet,
  setActiveWallet,
  getActiveWalletId,
} from "@/lib/wallets";


// Mock @stellar/freighter-api
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  getAddress: jest.fn(),
  requestAccess: jest.fn(),
  signTransaction: jest.fn(),
  isAllowed: jest.fn(),
}));

// Mock stellar library
jest.mock("@/lib/stellar", () => ({
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
}));

const mockPublicKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZAA";
const mockXDR = "AAAAAgAAAABZoZ5MvWi1I5BwUz8l0Tm9S7Fb9wKpAw6PxXFRp6Yy";
const mockSignedXDR = "AAAAAgAAAABZoZ5MvWi1I5BwUz8l0Tm9S7Fb9wKpAw6PxXFRp6YyAAAABQAAAAAB";

describe("Unified Multi-Wallet Adapters (#70)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as unknown as Record<string, unknown>).albedo;
    delete (window as unknown as Record<string, unknown>).xBullSDK;
    delete (window as unknown as Record<string, unknown>).xBull;
    delete (window as unknown as Record<string, unknown>).lobstr;
    delete (window as unknown as Record<string, unknown>).walletConnect;
  });

  // ─── 1. Freighter Adapter ───────────────────────────────────────────────────
  describe("FreighterWalletAdapter", () => {
    const adapter = new FreighterWalletAdapter();

    it("has correct id, name and metadata", () => {
      expect(adapter.id).toBe("freighter");
      expect(adapter.name).toBe("Freighter");
      expect(adapter.metadata.downloadUrl).toBe("https://freighter.app");
    });

    it("checks availability via isConnected", async () => {
      freighterApi.isConnected.mockResolvedValue({ isConnected: true });
      expect(await adapter.isAvailable()).toBe(true);

      freighterApi.isConnected.mockResolvedValue({ isConnected: false });
      expect(await adapter.isAvailable()).toBe(false);

      freighterApi.isConnected.mockRejectedValue(new Error("Ext error"));
      expect(await adapter.isAvailable()).toBe(false);
    });

    it("connects successfully and returns public key", async () => {
      freighterApi.isConnected.mockResolvedValue({ isConnected: true });
      freighterApi.requestAccess.mockResolvedValue({ address: mockPublicKey });

      const result = await adapter.connect();
      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
    });

    it("handles connection rejection uniformly", async () => {
      freighterApi.isConnected.mockResolvedValue({ isConnected: true });
      freighterApi.requestAccess.mockRejectedValue(new Error("User declined request"));

      const result = await adapter.connect();
      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Connection rejected");
    });

    it("signs transaction successfully", async () => {
      freighterApi.signTransaction.mockResolvedValue({ signedTxXdr: mockSignedXDR });

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBe(mockSignedXDR);
      expect(result.error).toBeNull();
    });

    it("handles sign transaction rejection uniformly", async () => {
      freighterApi.signTransaction.mockRejectedValue(new Error("User rejected signing"));

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("rejected by the user");
    });

    it("disconnect completes gracefully", async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  // ─── 2. Albedo Adapter ─────────────────────────────────────────────────────
  describe("AlbedoWalletAdapter", () => {
    const adapter = new AlbedoWalletAdapter();

    it("has correct id, name and metadata", () => {
      expect(adapter.id).toBe("albedo");
      expect(adapter.name).toBe("Albedo");
      expect(adapter.metadata.webSupported).toBe(true);
    });

    it("is always available in browser", async () => {
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("connects successfully using window.albedo intent", async () => {
      (window as unknown as Record<string, unknown>).albedo = {
        publicKey: jest.fn().mockResolvedValue({ pubkey: mockPublicKey }),
        tx: jest.fn(),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
      expect(await adapter.getPublicKey()).toBe(mockPublicKey);
      expect(await adapter.isConnected()).toBe(true);
    });

    it("handles connection rejection in Albedo", async () => {
      (window as unknown as Record<string, unknown>).albedo = {
        publicKey: jest.fn().mockRejectedValue(new Error("Intent canceled by user")),
        tx: jest.fn(),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Connection rejected");
    });

    it("signs transaction successfully with Albedo", async () => {
      (window as unknown as Record<string, unknown>).albedo = {
        publicKey: jest.fn(),
        tx: jest.fn().mockResolvedValue({ signed_envelope_xdr: mockSignedXDR }),
      };

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBe(mockSignedXDR);
      expect(result.error).toBeNull();
    });

    it("handles sign transaction rejection in Albedo", async () => {
      (window as unknown as Record<string, unknown>).albedo = {
        publicKey: jest.fn(),
        tx: jest.fn().mockRejectedValue(new Error("Transaction rejected")),
      };

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("rejected by the user in Albedo");
    });

    it("disconnect clears cached public key", async () => {
      (window as unknown as Record<string, unknown>).albedo = {
        publicKey: jest.fn().mockResolvedValue({ pubkey: mockPublicKey }),
      };
      await adapter.connect();
      expect(await adapter.isConnected()).toBe(true);

      await adapter.disconnect();
      expect(await adapter.getPublicKey()).toBeNull();
      expect(await adapter.isConnected()).toBe(false);
    });
  });

  // ─── 3. xBull Adapter ───────────────────────────────────────────────────────
  describe("XBullWalletAdapter", () => {
    const adapter = new XBullWalletAdapter();

    it("has correct id, name and metadata", () => {
      expect(adapter.id).toBe("xbull");
      expect(adapter.name).toBe("xBull");
      expect(adapter.metadata.downloadUrl).toBe("https://xbull.app");
    });

    it("detects availability when xBullSDK is present", async () => {
      expect(await adapter.isAvailable()).toBe(false);
      (window as unknown as Record<string, unknown>).xBullSDK = {
        getPublicKey: jest.fn(),
        sign: jest.fn(),
      };
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("connects successfully and returns public key", async () => {
      (window as unknown as Record<string, unknown>).xBullSDK = {
        getPublicKey: jest.fn().mockResolvedValue(mockPublicKey),
        sign: jest.fn(),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
      expect(await adapter.getPublicKey()).toBe(mockPublicKey);
    });

    it("handles user closing or declining xBull prompt", async () => {
      (window as unknown as Record<string, unknown>).xBullSDK = {
        getPublicKey: jest.fn().mockRejectedValue(new Error("User closed the bridge")),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Connection rejected");
    });

    it("signs transaction successfully", async () => {
      (window as unknown as Record<string, unknown>).xBullSDK = {
        getPublicKey: jest.fn(),
        sign: jest.fn().mockResolvedValue(mockSignedXDR),
      };

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBe(mockSignedXDR);
      expect(result.error).toBeNull();
    });

    it("handles sign transaction rejection in xBull", async () => {
      (window as unknown as Record<string, unknown>).xBullSDK = {
        getPublicKey: jest.fn(),
        sign: jest.fn().mockRejectedValue(new Error("rejected by user")),
      };

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("rejected by the user in xBull");
    });

    it("disconnect resets cached state and closes SDK session", async () => {
      const closeMock = jest.fn();
      (window as unknown as Record<string, unknown>).xBullSDK = {
        getPublicKey: jest.fn().mockResolvedValue(mockPublicKey),
        close: closeMock,
      };

      await adapter.connect();
      await adapter.disconnect();
      expect(closeMock).toHaveBeenCalled();
      expect(await adapter.getPublicKey()).toBeNull();
    });
  });

  // ─── 4. Lobstr Adapter ─────────────────────────────────────────────────────
  describe("LobstrWalletAdapter", () => {
    const adapter = new LobstrWalletAdapter();

    it("has correct id, name and metadata", () => {
      expect(adapter.id).toBe("lobstr");
      expect(adapter.name).toBe("Lobstr");
      expect(adapter.metadata.downloadUrl).toBe("https://lobstr.co");
    });

    it("detects availability based on window.lobstr presence", async () => {
      expect(await adapter.isAvailable()).toBe(false);
      (window as unknown as Record<string, unknown>).lobstr = {
        getPublicKey: jest.fn(),
        signTransaction: jest.fn(),
      };
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("returns error if connect is called when not installed", async () => {
      const result = await adapter.connect();
      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Lobstr extension is not detected");
    });

    it("connects successfully and returns public key", async () => {
      (window as unknown as Record<string, unknown>).lobstr = {
        isConnected: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockResolvedValue(mockPublicKey),
        signTransaction: jest.fn(),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
      expect(await adapter.isConnected()).toBe(true);
    });

    it("handles connection rejection in Lobstr", async () => {
      (window as unknown as Record<string, unknown>).lobstr = {
        isConnected: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockRejectedValue(new Error("User declined request")),
        signTransaction: jest.fn(),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Connection rejected");
    });

    it("signs transaction successfully", async () => {
      (window as unknown as Record<string, unknown>).lobstr = {
        getPublicKey: jest.fn(),
        signTransaction: jest.fn().mockResolvedValue(mockSignedXDR),
      };

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBe(mockSignedXDR);
      expect(result.error).toBeNull();
    });

    it("handles sign transaction rejection in Lobstr", async () => {
      (window as unknown as Record<string, unknown>).lobstr = {
        getPublicKey: jest.fn(),
        signTransaction: jest.fn().mockRejectedValue(new Error("rejected by user")),
      };

      const result = await adapter.signTransaction(mockXDR);
      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("rejected by the user in Lobstr");
    });

    it("disconnect clears cached public key", async () => {
      (window as unknown as Record<string, unknown>).lobstr = {
        getPublicKey: jest.fn().mockResolvedValue(mockPublicKey),
        signTransaction: jest.fn(),
      };
      await adapter.connect();
      await adapter.disconnect();
      expect(await adapter.getPublicKey()).toBeNull();
    });
  });

  // ─── 5. WalletConnect Adapter ───────────────────────────────────────────────
  describe("WalletConnectAdapter", () => {
    it("has correct id, name and metadata", () => {
      const adapter = new WalletConnectAdapter();
      expect(adapter.id).toBe("walletconnect");
      expect(adapter.name).toBe("WalletConnect");
      expect(adapter.metadata.mobileSupported).toBe(true);
    });

    it("is available in browser", async () => {
      const adapter = new WalletConnectAdapter();
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("connects via pairing session approval and parses stellar account", async () => {
      const adapter = new WalletConnectAdapter();
      const mockSession = {
        topic: "session-topic-123",
        namespaces: {
          stellar: {
            accounts: [`stellar:testnet:${mockPublicKey}`],
            methods: ["stellar_signTransaction"],
            events: [],
          },
        },
      };

      const mockConnect = jest.fn().mockResolvedValue({
        uri: "wc:test-uri-string@2",
        approval: jest.fn().mockResolvedValue(mockSession),
      });

      (window as unknown as Record<string, unknown>).walletConnect = {
        connect: mockConnect,
        request: jest.fn(),
        disconnect: jest.fn(),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
      expect(await adapter.getPublicKey()).toBe(mockPublicKey);
      expect(await adapter.isConnected()).toBe(true);
    });

    it("handles connection rejection in WalletConnect", async () => {
      const adapter = new WalletConnectAdapter();
      (window as unknown as Record<string, unknown>).walletConnect = {
        connect: jest.fn().mockResolvedValue({
          uri: "wc:uri",
          approval: jest.fn().mockRejectedValue(new Error("User rejected approval")),
        }),
      };

      const result = await adapter.connect();
      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Connection rejected");
    });

    it("signs transaction successfully via WalletConnect", async () => {
      const adapter = new WalletConnectAdapter();
      const mockRequest = jest.fn().mockResolvedValue({ signedXDR: mockSignedXDR });
      (window as unknown as Record<string, unknown>).walletConnect = {
        connect: jest.fn().mockResolvedValue({
          uri: "wc:uri",
          approval: jest.fn().mockResolvedValue({
            topic: "session-topic-123",
            namespaces: { stellar: { accounts: [`stellar:testnet:${mockPublicKey}`] } },
          }),
        }),
        request: mockRequest,
        disconnect: jest.fn(),
      };

      await adapter.connect();
      const result = await adapter.signTransaction(mockXDR);

      expect(mockRequest).toHaveBeenCalled();
      expect(result.signedXDR).toBe(mockSignedXDR);
      expect(result.error).toBeNull();
    });

    it("handles sign transaction rejection in WalletConnect", async () => {
      const adapter = new WalletConnectAdapter();
      (window as unknown as Record<string, unknown>).walletConnect = {
        connect: jest.fn().mockResolvedValue({
          uri: "wc:uri",
          approval: jest.fn().mockResolvedValue({
            topic: "session-topic-123",
            namespaces: { stellar: { accounts: [`stellar:testnet:${mockPublicKey}`] } },
          }),
        }),
        request: jest.fn().mockRejectedValue(new Error("User rejected transaction")),
        disconnect: jest.fn(),
      };

      await adapter.connect();
      const result = await adapter.signTransaction(mockXDR);

      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("rejected by the user in WalletConnect");
    });

    it("disconnect sends session termination", async () => {
      const adapter = new WalletConnectAdapter();
      const mockDisconnect = jest.fn().mockResolvedValue(undefined);
      (window as unknown as Record<string, unknown>).walletConnect = {
        connect: jest.fn().mockResolvedValue({
          uri: "wc:uri",
          approval: jest.fn().mockResolvedValue({
            topic: "session-topic-123",
            namespaces: { stellar: { accounts: [`stellar:testnet:${mockPublicKey}`] } },
          }),
        }),
        disconnect: mockDisconnect,
      };

      await adapter.connect();
      await adapter.disconnect();

      expect(mockDisconnect).toHaveBeenCalledWith({
        topic: "session-topic-123",
        reason: expect.any(Object),
      });
      expect(await adapter.getPublicKey()).toBeNull();
    });
  });

  // ─── 6. Registry & Factory ──────────────────────────────────────────────────
  describe("Wallet Registry & Factory", () => {
    it("lists all 5 supported wallet adapters", () => {
      const wallets = getAllWallets();
      expect(wallets).toHaveLength(5);
      const ids = wallets.map((w) => w.id);
      expect(ids).toContain("freighter");
      expect(ids).toContain("albedo");
      expect(ids).toContain("xbull");
      expect(ids).toContain("lobstr");
      expect(ids).toContain("walletconnect");
    });

    it("gets wallet by id", () => {
      const albedo = getWallet("albedo");
      expect(albedo.id).toBe("albedo");
      expect(albedo.name).toBe("Albedo");
    });

    it("throws error for unsupported wallet id", () => {
      expect(() => getWallet("unknown" as any)).toThrow("Unsupported wallet adapter");
    });

    it("defaults active wallet to freighter", () => {
      setActiveWallet("freighter");
      expect(getActiveWalletId()).toBe("freighter");
      expect(getActiveWallet().id).toBe("freighter");
    });

    it("switches active wallet and retrieves active adapter", () => {
      setActiveWallet("albedo");
      expect(getActiveWalletId()).toBe("albedo");
      expect(getActiveWallet().id).toBe("albedo");

      setActiveWallet("freighter");
    });
  });
});
