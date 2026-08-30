/**
 * __tests__/trezor-connect-flow.test.ts
 * Integration tests for lib/trezor.ts connect + sign flows with a mocked
 * @trezor/connect module (resolved via jest moduleNameMapper).
 */

import { getTrezorPublicKey, signTransactionWithTrezor, disconnectTrezor } from "@/lib/trezor";
import {
  mockInit,
  mockStellarGetPublicKey,
  mockStellarSignTransaction,
  mockDispose,
} from "./mocks/trezor-connect";

jest.mock("@/lib/stellar", () => ({
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
}));

// jsdom provides window/document, which trezor.ts checks for support.

beforeEach(() => {
  jest.clearAllMocks();
});

const KEY = "GDTREZ" + "O".repeat(49);

describe("getTrezorPublicKey", () => {
  it("initialises Trezor Connect and returns the public key on success", async () => {
    mockStellarGetPublicKey.mockResolvedValue({ success: true, payload: { publicKey: KEY } });

    const result = await getTrezorPublicKey();

    expect(result).toEqual({ publicKey: KEY, error: null });
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ manifest: expect.objectContaining({ email: "support@finchippay.dev" }) })
    );
    expect(mockStellarGetPublicKey).toHaveBeenCalledWith({
      path: "m/44'/148'/0'",
      showOnTrezor: true,
    });
  });

  it("returns a mapped error when Trezor rejects", async () => {
    mockStellarGetPublicKey.mockResolvedValue({
      success: false,
      error: "Device is locked",
    });

    const result = await getTrezorPublicKey();

    expect(result.publicKey).toBeNull();
    expect(result.error).toContain("unlock it with your PIN");
  });
});

describe("signTransactionWithTrezor", () => {
  it("attaches the returned signature to the envelope and returns base64 XDR", async () => {
    const sdk = jest.requireActual("@stellar/stellar-sdk");
    const kp = sdk.Keypair.random();
    const account = new sdk.Account(kp.publicKey(), "12345");
    const { TransactionBuilder, Networks, Operation, Asset } = sdk;
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: sdk.Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
      .setTimeout(30)
      .build();
    const xdr = tx.toXDR();

    // Real signature over the transaction hash (raw 64-byte hex)
    const signature = kp.sign(Buffer.from(tx.hash().toString("hex"), "hex")).toString("hex");

    mockStellarSignTransaction.mockResolvedValue({
      success: true,
      payload: { publicKey: kp.publicKey(), signature },
    });

    const result = await signTransactionWithTrezor(xdr, kp.publicKey());

    expect(result.error).toBeNull();
    expect(result.signedXDR).toBeTruthy();

    // Parse the signed envelope back and verify a signature is present
    const signed = sdk.TransactionBuilder.fromXDR(result.signedXDR, Networks.TESTNET);
    expect(signed.signatures.length).toBe(1);
    expect(result.signedXDR).not.toBe(xdr);
  });

  it("returns a mapped error when signing fails", async () => {
    // Build a valid unsigned transaction so the flow reaches the signing step.
    const sdk = jest.requireActual("@stellar/stellar-sdk");
    const kp = sdk.Keypair.random();
    const account = new sdk.Account(kp.publicKey(), "12345");
    const { TransactionBuilder, Networks, Operation, Asset } = sdk;
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: sdk.Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
      .setTimeout(30)
      .build();

    mockStellarSignTransaction.mockResolvedValue({
      success: false,
      error: "User declined",
    });

    const result = await signTransactionWithTrezor(tx.toXDR(), kp.publicKey());

    expect(result.signedXDR).toBeNull();
    expect(result.error).toContain("rejected on the Trezor device");
  });
});

describe("disconnectTrezor", () => {
  it("disposes the Trezor Connect session", async () => {
    await disconnectTrezor();
    expect(mockDispose).toHaveBeenCalled();
  });
});