/**
 * lib/wallets/registry.ts
 * Wallet registry managing multi-wallet adapters and active wallet state (#70).
 */

import { AlbedoWalletAdapter } from "./albedo";
import { FreighterWalletAdapter } from "./freighter";
import { LobstrWalletAdapter } from "./lobstr";
import { StellarWallet, WalletId } from "./types";
import { WalletConnectAdapter } from "./walletconnect";
import { XBullWalletAdapter } from "./xbull";

const ACTIVE_WALLET_STORAGE_KEY = "finchippay:active_wallet_id";

class WalletRegistry {
  private adapters: Map<WalletId, StellarWallet> = new Map();
  private activeWalletId: WalletId = "freighter";

  constructor() {
    this.register(new FreighterWalletAdapter());
    this.register(new AlbedoWalletAdapter());
    this.register(new XBullWalletAdapter());
    this.register(new LobstrWalletAdapter());
    this.register(new WalletConnectAdapter());

    if (typeof window !== "undefined") {
      const savedId = window.localStorage.getItem(ACTIVE_WALLET_STORAGE_KEY) as WalletId | null;
      if (savedId && this.adapters.has(savedId)) {
        this.activeWalletId = savedId;
      }
    }
  }

  register(adapter: StellarWallet): void {
    this.adapters.set(adapter.id, adapter);
  }

  getWallet(id: WalletId): StellarWallet {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Unsupported wallet adapter: ${id}`);
    }
    return adapter;
  }

  getAllWallets(): StellarWallet[] {
    return Array.from(this.adapters.values());
  }

  getActiveWalletId(): WalletId {
    return this.activeWalletId;
  }

  getActiveWallet(): StellarWallet {
    return this.getWallet(this.activeWalletId);
  }

  setActiveWallet(id: WalletId): void {
    if (!this.adapters.has(id)) {
      throw new Error(`Cannot set unknown wallet as active: ${id}`);
    }
    this.activeWalletId = id;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ACTIVE_WALLET_STORAGE_KEY, id);
      } catch {
        // Ignore storage errors
      }
    }
  }
}

export const walletRegistry = new WalletRegistry();

export function getWallet(id: WalletId): StellarWallet {
  return walletRegistry.getWallet(id);
}

export function getAllWallets(): StellarWallet[] {
  return walletRegistry.getAllWallets();
}

export function getActiveWallet(): StellarWallet {
  return walletRegistry.getActiveWallet();
}

export function setActiveWallet(id: WalletId): void {
  walletRegistry.setActiveWallet(id);
}

export function getActiveWalletId(): WalletId {
  return walletRegistry.getActiveWalletId();
}
