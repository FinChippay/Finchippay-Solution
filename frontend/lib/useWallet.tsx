/**
 * lib/useWallet.tsx
 * Multi-account wallet state for Finchippay (#147).
 *
 * Freighter exposes one address at a time, so Finchippay keeps its own list of
 * the accounts the user has connected. Exactly one of them is "active"; every
 * page reads the active account's public key and therefore renders balances,
 * history, and analytics for that account only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/router";
import {
  connectWallet as requestWalletConnection,
  disconnectWallet as clearWalletConnection,
  getConnectedPublicKey,
  performSEP0010Auth,
} from "@/lib/wallet";

/** A single Stellar account the user has connected to Finchippay. */
export interface Account {
  publicKey: string;
  /** User-assigned nickname, editable from the settings page. */
  label?: string;
  /** The first account in the list; used as the default on a fresh load. */
  isPrimary: boolean;
}

interface WalletContextValue {
  accounts: Account[];
  activeAccountIndex: number;
  activeAccount: Account | null;
  /**
   * Public key of the active account. Exposed at the top level so pages that
   * only care about "the account in use" never have to unwrap `activeAccount`.
   */
  publicKey: string | null;
  isWalletReady: boolean;
  setActiveAccount: (index: number) => void;
  /** Prompt Freighter for an account and append it to the list. */
  addAccount: () => Promise<{ error: string | null }>;
  removeAccount: (publicKey: string) => void;
  setAccountLabel: (publicKey: string, label: string) => void;
  /** Add (or re-activate) an account that has already been authenticated. */
  connectWallet: (nextPublicKey: string) => void;
  /** Remove every account and clear the app's auth state. */
  disconnectWallet: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export const STORAGE_KEY = "finchippay:accounts";

/**
 * Pre-#147 storage key holding a single public key. Read once on load so
 * existing users stay connected after upgrading.
 */
const LEGACY_PUBLIC_KEY_STORAGE_KEY = "finchippay:last-public-key";

interface AccountsState {
  accounts: Account[];
  activeIndex: number;
}

const EMPTY_STATE: AccountsState = { accounts: [], activeIndex: 0 };

function isValidPublicKey(value: unknown): value is string {
  return typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value);
}

/** Re-flag the first entry as primary after an add or remove. */
function withPrimaryFlags(accounts: Account[]): Account[] {
  return accounts.map((account, index) => ({ ...account, isPrimary: index === 0 }));
}

/** Coerce whatever is in localStorage into a well-formed account list. */
function normalizeAccounts(input: unknown): Account[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const accounts: Account[] = [];

  for (const entry of input) {
    const publicKey = (entry as Account | null)?.publicKey;
    if (!isValidPublicKey(publicKey) || seen.has(publicKey)) continue;
    seen.add(publicKey);

    const label = (entry as Account).label;
    accounts.push({
      publicKey,
      label: typeof label === "string" && label.trim() ? label.trim() : undefined,
      isPrimary: false,
    });
  }

  return withPrimaryFlags(accounts);
}

function loadAccounts(): Account[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeAccounts(JSON.parse(raw));
    }

    const legacyPublicKey = window.localStorage.getItem(LEGACY_PUBLIC_KEY_STORAGE_KEY);
    if (isValidPublicKey(legacyPublicKey)) {
      return [{ publicKey: legacyPublicKey, isPrimary: true }];
    }

    return [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: Account[]) {
  if (typeof window === "undefined") return;

  try {
    if (accounts.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
      // Mirror the primary key into the legacy slot so anything still reading
      // the old key (service worker, older tab) resolves a valid account.
      window.localStorage.setItem(LEGACY_PUBLIC_KEY_STORAGE_KEY, accounts[0].publicKey);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_PUBLIC_KEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures (private browsing, full quota, etc.).
  }
}

/** Add a key to the list (or select it if already present) in one transition. */
function reduceAddAccount(state: AccountsState, publicKey: string): AccountsState {
  const existingIndex = state.accounts.findIndex((a) => a.publicKey === publicKey);
  if (existingIndex >= 0) {
    return state.activeIndex === existingIndex
      ? state
      : { ...state, activeIndex: existingIndex };
  }

  const accounts = withPrimaryFlags([...state.accounts, { publicKey, isPrimary: false }]);
  return { accounts, activeIndex: accounts.length - 1 };
}

/**
 * Human-friendly name for an account: its label, or "Account N" as a fallback.
 */
export function getAccountDisplayName(account: Account, index: number): string {
  return account.label?.trim() || `Account ${index + 1}`;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AccountsState>(() => ({
    accounts: loadAccounts(),
    activeIndex: 0,
  }));
  const [isWalletReady, setIsWalletReady] = useState(false);

  const { accounts, activeIndex } = state;

  useEffect(() => {
    saveAccounts(accounts);
  }, [accounts]);

  const connectWallet = useCallback((nextPublicKey: string) => {
    if (!isValidPublicKey(nextPublicKey)) return;
    setState((current) => reduceAddAccount(current, nextPublicKey));
  }, []);

  useEffect(() => {
    let isActive = true;

    getConnectedPublicKey()
      .then((connectedPublicKey) => {
        if (!isActive) return;

        if (!connectedPublicKey) {
          // Site access was revoked in Freighter — drop the cached list.
          setState(EMPTY_STATE);
          return;
        }

        // Freighter's currently selected address counts as a connected account,
        // but it must not steal focus from the account the user picked here.
        setState((current) =>
          current.accounts.some((a) => a.publicKey === connectedPublicKey)
            ? current
            : {
                accounts: withPrimaryFlags([
                  ...current.accounts,
                  { publicKey: connectedPublicKey, isPrimary: false },
                ]),
                activeIndex: current.accounts.length === 0 ? 0 : current.activeIndex,
              }
        );
      })
      .finally(() => {
        if (isActive) {
          setIsWalletReady(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const activeAccount = accounts[activeIndex] ?? accounts[0] ?? null;

  const setActiveAccount = useCallback((index: number) => {
    setState((current) =>
      index < 0 || index >= current.accounts.length || index === current.activeIndex
        ? current
        : { ...current, activeIndex: index }
    );
  }, []);

  const addAccount = useCallback(async (): Promise<{ error: string | null }> => {
    const { publicKey, error: walletError } = await requestWalletConnection();

    if (walletError || !publicKey) {
      return { error: walletError || "Could not retrieve public key." };
    }

    // Every account proves ownership of its own key via SEP-0010, so the JWT
    // held by the API client always matches the account being used.
    const { error: authError } = await performSEP0010Auth(publicKey);
    if (authError) {
      return { error: authError };
    }

    connectWallet(publicKey);
    return { error: null };
  }, [connectWallet]);

  const disconnectWallet = useCallback(() => {
    clearWalletConnection();
    setState(EMPTY_STATE);
    router.push("/");
  }, [router]);

  const removeAccount = useCallback(
    (publicKey: string) => {
      const index = accounts.findIndex((a) => a.publicKey === publicKey);
      if (index < 0) return;

      const remaining = withPrimaryFlags(accounts.filter((a) => a.publicKey !== publicKey));

      if (remaining.length === 0) {
        // Removing the last account disconnects the wallet entirely.
        disconnectWallet();
        return;
      }

      const nextIndex = Math.min(
        activeIndex > index ? activeIndex - 1 : activeIndex,
        remaining.length - 1
      );
      setState({ accounts: remaining, activeIndex: nextIndex });
    },
    [accounts, activeIndex, disconnectWallet]
  );

  const setAccountLabel = useCallback((publicKey: string, label: string) => {
    const trimmed = label.trim();
    setState((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.publicKey === publicKey
          ? { ...account, label: trimmed || undefined }
          : account
      ),
    }));
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      accounts,
      activeAccountIndex: activeAccount ? activeIndex : 0,
      activeAccount,
      publicKey: activeAccount?.publicKey ?? null,
      isWalletReady,
      setActiveAccount,
      addAccount,
      removeAccount,
      setAccountLabel,
      connectWallet,
      disconnectWallet,
    }),
    [
      accounts,
      activeIndex,
      activeAccount,
      isWalletReady,
      setActiveAccount,
      addAccount,
      removeAccount,
      setAccountLabel,
      connectWallet,
      disconnectWallet,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }

  return context;
}
