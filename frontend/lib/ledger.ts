/**
 * lib/ledger.ts
 * Ledger hardware wallet integration for Finchippay Solution.
 *
 * Communicates with a Ledger Nano S/X device via WebUSB
 * using the @ledgerhq/hw-transport-webusb and @ledgerhq/hw-app-str packages.
 */

import { getNetworkPassphrase } from "./stellar";

// Ledger hardware wallet transport types (imported dynamically to avoid bundling)
interface LedgerTransport {
  close(): Promise<void>;
}

interface LedgerStellarApp {
  getPublicKey(path: string): Promise<{ publicKey: string }>;
  signTransaction(path: string, xdr: string): Promise<{ signature: string }>;
}

let transportInstance: LedgerTransport | null = null;
let stellarAppInstance: LedgerStellarApp | null = null;

/**
 * Check if WebUSB is available in this browser.
 */
export function isWebUSBSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/**
 * Check if Ledger support is available (WebUSB supported + device accessible).
 */
export async function isLedgerSupported(): Promise<boolean> {
  return isWebUSBSupported();
}

/**
 * Connect to the Ledger device and return the public key.
 */
export async function connectLedger(): Promise<{
  publicKey: string | null;
  error: string | null;
}> {
  if (!isWebUSBSupported()) {
    return {
      publicKey: null,
      error: "WebUSB is not supported in this browser. Please use Chrome, Edge, or Brave.",
    };
  }

  try {
    // @ts-expect-error - @ledgerhq packages are optional peer dependencies
    const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
    // @ts-expect-error - @ledgerhq packages are optional peer dependencies
    const StellarApp = (await import("@ledgerhq/hw-app-str")).default;

    transportInstance = await TransportWebUSB.create();
    stellarAppInstance = new StellarApp(transportInstance);

    const result = await stellarAppInstance.getPublicKey("44'/148'/0'");
    return { publicKey: result.publicKey, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("No device selected") || message.includes("Access denied")) {
      return { publicKey: null, error: "Ledger connection was cancelled. Please approve the connection on your device." };
    }
    if (message.includes("CLA_NOT_SUPPORTED") || message.includes("0x6e00")) {
      return { publicKey: null, error: "Please open the Stellar app on your Ledger device." };
    }
    if (message.includes("Locked") || message.includes("0x530c")) {
      return { publicKey: null, error: "Ledger device is locked. Please unlock it and try again." };
    }
    if (message.includes("TransportError") || message.includes("disconnected")) {
      return { publicKey: null, error: "Ledger device disconnected. Please reconnect and try again." };
    }

    return { publicKey: null, error: `Ledger connection failed: ${message}` };
  }
}

/**
 * Sign a transaction XDR with the Ledger device.
 */
export async function signTransactionWithLedger(
  xdr: string,
  _publicKey: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  if (!stellarAppInstance) {
    return { signedXDR: null, error: "Ledger not connected. Please connect your device first." };
  }

  try {
    const result = await stellarAppInstance.signTransaction(
      "44'/148'/0'",
      xdr
    );
    return { signedXDR: result.signature, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("User declined") || message.includes("rejected") || message.includes("cancelled")) {
      return { signedXDR: null, error: "Transaction was rejected on the Ledger device." };
    }
    if (message.includes("Not connected") || message.includes("disconnected")) {
      return { signedXDR: null, error: "Ledger device disconnected during signing. Please reconnect and try again." };
    }

    return { signedXDR: null, error: `Ledger signing failed: ${message}` };
  }
}

/**
 * Get the public key from a connected Ledger device.
 */
export async function getLedgerPublicKey(): Promise<{
  publicKey: string | null;
  error: string | null;
}> {
  if (!stellarAppInstance) {
    return { publicKey: null, error: "Ledger not connected." };
  }

  try {
    const result = await stellarAppInstance.getPublicKey("44'/148'/0'");
    return { publicKey: result.publicKey, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { publicKey: null, error: `Failed to get Ledger public key: ${message}` };
  }
}

/**
 * Close the Ledger transport connection.
 */
export async function disconnectLedger(): Promise<void> {
  if (transportInstance) {
    try {
      await transportInstance.close();
    } catch {
      // Transport may already be closed
    }
    transportInstance = null;
    stellarAppInstance = null;
  }
}