/**
 * lib/trezor.ts
 * Trezor hardware wallet integration for Finchippay Solution.
 *
 * Communicates with a Trezor One / Model T device via the Trezor Connect
 * bridge using the @trezor/connect package. The package is loaded lazily
 * (dynamic import) to keep it out of the main bundle, mirroring how the
 * Ledger integration in lib/ledger.ts loads @ledgerhq.
 *
 * Stellar is exposed by Trezor Connect as:
 *   - TrezorConnect.stellarGetPublicKey({ path }) -> { publicKey }
 *   - TrezorConnect.stellarSignTransaction({ path, networkPassphrase, transaction })
 *                                                    -> { publicKey, signature }
 * Trezor expects the transaction as a structured StellarTransaction object
 * (not an XDR string). We parse the XDR with stellar-sdk and convert it.
 */

import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { getNetworkPassphrase } from "./stellar";

// Stellar BIP44 derivation path used by the Trezor Stellar app.
export const TREZOR_STELLAR_PATH = "m/44'/148'/0'";

// ─── Local type aliases (mirror the Trezor Connect schema) ──────────────────

export type TrezorAsset =
  | { type: "native" }
  | { type: "credit_alphanum4"; code: string; issuer: string }
  | { type: "credit_alphanum12"; code: string; issuer: string };

export type TrezorMemo =
  | { type: "none" }
  | { type: "text"; text: string }
  | { type: "id"; id: string }
  | { type: "hash"; hash: string }
  | { type: "return"; hash: string };

export interface TrezorTransaction {
  source: string;
  fee: number;
  sequence: number;
  timebounds?: { minTime: number; maxTime: number };
  memo?: TrezorMemo;
  operations: unknown[];
}

export interface TrezorSignResult {
  publicKey: string;
  signature: string;
}

/** Minimal shape of the lazily-loaded @trezor/connect module. */
interface TrezorConnectModule {
  init(options: { manifest?: { email: string; appUrl: string }; lazyLoad?: boolean }): Promise<unknown>;
  dispose?(): Promise<unknown>;
  stellarGetPublicKey(params: {
    path: string;
    showOnTrezor?: boolean;
  }): Promise<{ success: boolean; payload?: { publicKey?: string }; error?: string }>;
  stellarSignTransaction(params: {
    path: string;
    networkPassphrase: string;
    transaction: TrezorTransaction;
  }): Promise<{ success: boolean; payload?: TrezorSignResult; error?: string }>;
}

let connectModulePromise: Promise<TrezorConnectModule> | null = null;

export function isTrezorSupported(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Lazily load and initialise @trezor/connect. Kept as an optional peer
 * dependency (dynamic import), same as @ledgerhq in lib/ledger.ts.
 */
async function loadTrezorConnect(): Promise<TrezorConnectModule> {
  if (!connectModulePromise) {
    connectModulePromise = (async () => {
      // @ts-expect-error @trezor/connect is an optional peer dependency
      const mod = await import("@trezor/connect");
      const TrezorConnect: TrezorConnectModule = mod.default ?? mod;

      if (typeof TrezorConnect.init === "function" && typeof window !== "undefined") {
        await TrezorConnect.init({
          manifest: {
            email: "support@finchippay.dev",
            appUrl:
              typeof window !== "undefined" ? window.location.origin : "https://finchippay.app",
          },
          lazyLoad: true,
        });
      }
      return TrezorConnect;
    })();
  }
  return connectModulePromise;
}

/**
 * Get the Stellar public key from the connected Trezor device.
 */
export async function getTrezorPublicKey(): Promise<{
  publicKey: string | null;
  error: string | null;
}> {
  if (!isTrezorSupported()) {
    return {
      publicKey: null,
      error: "Trezor requires a browser environment. Please open Finchippay in a browser tab.",
    };
  }

  try {
    const TrezorConnect = await loadTrezorConnect();
    const result = await TrezorConnect.stellarGetPublicKey({
      path: TREZOR_STELLAR_PATH,
      showOnTrezor: true,
    });

    if (!result.success || !result.payload?.publicKey) {
      return { publicKey: null, error: mapTrezorError(result.error) };
    }

    return { publicKey: result.payload.publicKey, error: null };
  } catch (err: unknown) {
    return { publicKey: null, error: mapTrezorError(stringifyError(err)) };
  }
}

/**
 * Sign a transaction XDR with the Trezor device.
 *
 * Returns the signed envelope (base64 XDR). Trezor Connect only returns the
 * raw signature, so we attach it back onto the transaction envelope here.
 */
export async function signTransactionWithTrezor(
  xdr: string,
  publicKey: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  if (!isTrezorSupported()) {
    return {
      signedXDR: null,
      error: "Trezor requires a browser environment. Please open Finchippay in a browser tab.",
    };
  }

  try {
    const TrezorConnect = await loadTrezorConnect();

    const tx = parseTransaction(xdr);
    const trezorTx = toTrezorTransaction(tx);
    const networkPassphrase = getNetworkPassphrase();

    const result = await TrezorConnect.stellarSignTransaction({
      path: TREZOR_STELLAR_PATH,
      networkPassphrase,
      transaction: trezorTx,
    });

    if (!result.success || !result.payload?.signature) {
      return { signedXDR: null, error: mapTrezorError(result.error) };
    }

    const signedXDR = attachSignature(xdr, publicKey, result.payload.signature);
    return { signedXDR, error: null };
  } catch (err: unknown) {
    return { signedXDR: null, error: mapTrezorError(stringifyError(err)) };
  }
}

/**
 * Close / clean up the Trezor Connect session.
 */
export async function disconnectTrezor(): Promise<void> {
  if (!connectModulePromise) return;
  try {
    const TrezorConnect = await connectModulePromise;
    await TrezorConnect.dispose?.();
  } catch {
    // Session may already be disposed
  } finally {
    connectModulePromise = null;
  }
}

// ─── Error mapping (clear guidance for connect/unlock flows) ─────────────────

export function mapTrezorError(raw: string | undefined | null): string {
  const message = raw || "Unknown Trezor error";

  if (/cancel/i.test(message)) {
    return "Trezor connection was cancelled. Please approve the connection on your device.";
  }
  if (/popup|initializ|iframe|connect not initialized/i.test(message)) {
    return "Trezor Connect is not ready. Please allow the Trezor popup and try again.";
  }
  if (/bridge|disconnected|no transport|hid/i.test(message)) {
    return "Trezor bridge is not running. Please install/start Trezor Bridge and reconnect the device.";
  }
  if (/locked|pin|passphrase|unlock/i.test(message)) {
    return "Trezor device is locked. Please unlock it with your PIN and try again.";
  }
  if (/device not found|not connected|no device/i.test(message)) {
    return "No Trezor device detected. Please connect and unlock your Trezor.";
  }
  if (/stellar app|firmware|unsupported/i.test(message)) {
    return "Please open the Stellar app on your Trezor (or upgrade the firmware) and try again.";
  }
  if (/declined|rejected|denied/i.test(message)) {
    return "Transaction was rejected on the Trezor device.";
  }

  return `Trezor error: ${message}`;
}

// ─── XDR parsing & conversion helpers ────────────────────────────────────────

function stringifyError(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return undefined;
}

/** Parse a base64 XDR string into a stellar-sdk Transaction instance. */
export function parseTransaction(xdr: string): Transaction {
  return TransactionBuilder.fromXDR(xdr, getNetworkPassphrase()) as Transaction;
}

/**
 * Convert a stellar-sdk Transaction into the structured form Trezor Connect
 * expects for stellarSignTransaction.
 */
export function toTrezorTransaction(tx: Transaction): TrezorTransaction {
  const memo = tx.memo && tx.memo.type !== "none" ? toTrezorMemo(tx.memo) : undefined;

  return {
    source: tx.source ?? "",
    fee: Number(tx.fee) || 0,
    sequence: Number(tx.sequence) || 0,
    ...(tx.timeBounds
      ? {
          timebounds: {
            minTime: Number(tx.timeBounds.minTime) || 0,
            maxTime: Number(tx.timeBounds.maxTime) || 0,
          },
        }
      : {}),
    ...(memo ? { memo } : {}),
    operations: tx.operations
      .map((op) => mapOperation(op as unknown as Record<string, unknown>))
      .filter((op): op is Record<string, unknown> => Boolean(op)),
  };
}

function toTrezorMemo(memo: { type: string; value?: unknown }): TrezorMemo {
  switch (memo.type) {
    case "text":
      return { type: "text", text: String(memo.value ?? "") };
    case "id":
      return { type: "id", id: String(memo.value ?? "0") };
    case "hash":
      return { type: "hash", hash: String(memo.value ?? "") };
    case "return":
      return { type: "return", hash: String(memo.value ?? "") };
    default:
      return { type: "none" };
  }
}

/** Normalise a stellar-sdk Asset into the Trezor asset shape. */
function normalizeAsset(asset: unknown): TrezorAsset {
  if (!asset || typeof asset !== "object") return { type: "native" };
  const a = asset as {
    isNative?: () => boolean;
    getCode?: () => string;
    getIssuer?: () => string;
  };
  if (typeof a.isNative === "function" && a.isNative()) return { type: "native" };
  const code = typeof a.getCode === "function" ? a.getCode() : "";
  const issuer = typeof a.getIssuer === "function" ? a.getIssuer() : "";
  if (code && issuer) {
    return {
      type: code.length > 4 ? "credit_alphanum12" : "credit_alphanum4",
      code,
      issuer,
    };
  }
  return { type: "native" };
}

/** Convert a decimal price string (e.g. "2.5") to a reduced fraction {n, d}. */
export function priceToFraction(price: unknown): { n: number; d: number } {
  if (price && typeof price === "object") {
    const p = price as { n?: unknown; d?: unknown };
    const n = Number(p.n);
    const d = Number(p.d);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return { n, d };
  }
  const str = String(price ?? "0");
  const match = str.match(/^(-?\d+)(?:\.(\d+))?$/);
  if (!match) return { n: 0, d: 1 };
  const int = BigInt(match[1]);
  const frac = match[2] ?? "";
  const numerator = int * BigInt(10) ** BigInt(frac.length) + BigInt(frac || "0");
  const denominator = BigInt(10) ** BigInt(frac.length);
  const g = gcd(numerator, denominator);
  return { n: Number(numerator / g), d: Number(denominator / g) };
}

function gcd(a: bigint, b: bigint): bigint {
  return b === BigInt(0) ? a : gcd(b, a % b);
}

/** Map a stellar-sdk Operation to the Trezor operation shape. */
export function mapOperation(op: Record<string, unknown>): Record<string, unknown> | null {
  const type = (op.type as string) ?? "";
  const base: Record<string, unknown> = { type };
  if (op.source) base.source = String(op.source);

  switch (type) {
    case "createAccount":
      return {
        ...base,
        destination: String(op.destination),
        startingBalance: String(op.startingBalance ?? "0"),
      };
    case "payment":
      return {
        ...base,
        destination: String(op.destination),
        asset: normalizeAsset(op.asset),
        amount: String(op.amount ?? "0"),
      };
    case "pathPaymentStrictReceive":
      return {
        ...base,
        sendAsset: normalizeAsset(op.sendAsset),
        sendMax: String(op.sendMax ?? "0"),
        destination: String(op.destination),
        destAsset: normalizeAsset(op.destAsset),
        destAmount: String(op.destAmount ?? "0"),
        path: Array.isArray(op.path) ? op.path.map(normalizeAsset) : [],
      };
    case "pathPaymentStrictSend":
      return {
        ...base,
        sendAsset: normalizeAsset(op.sendAsset),
        sendAmount: String(op.sendAmount ?? "0"),
        destination: String(op.destination),
        destAsset: normalizeAsset(op.destAsset),
        destMin: String(op.destMin ?? "0"),
        path: Array.isArray(op.path) ? op.path.map(normalizeAsset) : [],
      };
    case "createPassiveSellOffer":
    case "manageSellOffer":
    case "manageBuyOffer":
      return {
        ...base,
        selling: normalizeAsset(op.selling),
        buying: normalizeAsset(op.buying),
        amount: String(op.amount ?? "0"),
        price: priceToFraction(op.price),
        ...(type === "manageSellOffer" || type === "manageBuyOffer"
          ? { offerId: Number(op.offerId) || 0 }
          : {}),
      };
    case "setOptions":
      return {
        ...base,
        ...(op.inflationDest ? { inflationDest: String(op.inflationDest) } : {}),
        ...(op.clearFlags !== undefined ? { clearFlags: Number(op.clearFlags) } : {}),
        ...(op.setFlags !== undefined ? { setFlags: Number(op.setFlags) } : {}),
        ...(op.masterWeight !== undefined ? { masterWeight: Number(op.masterWeight) } : {}),
        ...(op.lowThreshold !== undefined ? { lowThreshold: Number(op.lowThreshold) } : {}),
        ...(op.medThreshold !== undefined ? { medThreshold: Number(op.medThreshold) } : {}),
        ...(op.highThreshold !== undefined ? { highThreshold: Number(op.highThreshold) } : {}),
        ...(op.homeDomain ? { homeDomain: String(op.homeDomain) } : {}),
        ...(op.signer ? { signer: op.signer as Record<string, unknown> } : {}),
      };
    case "changeTrust":
      return { ...base, line: normalizeAsset(op.line), limit: String(op.limit ?? "0") };
    case "allowTrust":
      return {
        ...base,
        trustor: String(op.trustor),
        assetType: Number(op.assetType ?? 0),
        assetCode: op.assetCode ? String(op.assetCode) : undefined,
        authorize: Boolean(op.authorize),
      };
    case "accountMerge":
      return { ...base, destination: String(op.destination) };
    case "manageData":
      return {
        ...base,
        name: String(op.name ?? ""),
        value: op.value !== undefined && op.value !== null ? String(op.value) : undefined,
      };
    case "bumpSequence":
      return { ...base, bumpTo: String(op.bumpTo ?? "0") };
    case "claimClaimableBalance":
      return { ...base, balanceId: String(op.balanceId ?? "") };
    default:
      return null;
  }
}

/**
 * Attach the raw signature returned by Trezor back onto the transaction
 * envelope, producing a signed base64 XDR.
 */
export function attachSignature(xdr: string, publicKey: string, signatureHex: string): string {
  const tx = parseTransaction(xdr);
  const raw = normalizeSignature(signatureHex);
  const signatureBuffer = Buffer.from(raw, "hex");
  tx.addSignature(publicKey, signatureBuffer.toString("base64"));
  return tx.toEnvelope().toXDR("base64");
}

/**
 * Trezor returns signatures as either raw (64-byte hex) or DER-encoded hex.
 * Normalise to raw hex so stellar-sdk's addSignature can verify it.
 */
export function normalizeSignature(signature: string): string {
  const hex = signature.replace(/^0x/i, "").trim();
  if (hex.length === 128) return hex; // raw 64-byte ed25519 signature

  // DER-encoded signature: [30 len 02 rLen r 02 sLen s]
  try {
    return derToRaw(hex);
  } catch {
    return hex;
  }
}

function derToRaw(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length < 8 || bytes[0] !== 0x30) return hex;

  // DER: 30 <seqLen> 02 <rLen> <r> 02 <sLen> <s>
  let pos = 1;
  if (bytes[pos] & 0x80) {
    const numLenBytes = bytes[pos] & 0x7f;
    pos += 1 + numLenBytes;
  } else {
    pos += 1;
  }
  // r integer
  if (bytes[pos] !== 0x02) return hex;
  pos += 1;
  const rLen = bytes[pos];
  pos += 1;
  let r = bytes.subarray(pos, pos + rLen);
  pos += rLen;
  // s integer
  if (bytes[pos] !== 0x02) return hex;
  pos += 1;
  const sLen = bytes[pos];
  pos += 1;
  let s = bytes.subarray(pos, pos + sLen);

  r = stripLeadingZero(r);
  s = stripLeadingZero(s);
  const rPad = Math.max(0, 32 - r.length);
  const sPad = Math.max(0, 32 - s.length);

  if (r.length + rPad > 32 || s.length + sPad > 32) return hex;
  const raw = Buffer.concat([Buffer.alloc(rPad), r, Buffer.alloc(sPad), s]);
  return raw.length === 64 ? raw.toString("hex") : hex;
}

function stripLeadingZero(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i += 1;
  return buf.subarray(i);
}