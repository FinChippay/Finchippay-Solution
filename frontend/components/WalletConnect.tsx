/**
 * components/WalletConnect.tsx
 * Unified Multi-Wallet connection UI (#70).
 * Supports Freighter, Albedo, xBull, Lobstr, WalletConnect, and Ledger.
 */

import { useState, useEffect } from "react";
import { withErrorBoundary } from "@/components/ErrorBoundary";
import {
  LedgerIcon,
  WalletIcon,
  PuzzleIcon,
  ExternalLinkIcon,
  Spinner,
  QrCodeIcon,
} from "@/components/icons";
import { useWallet } from "@/lib/useWallet";
import {
  connectWallet as requestWalletConnection,
  isFreighterInstalled,
  detectBrowser,
  EXTENSION_URLS,
  performSEP0010Auth,
  getLedgerPublicKey,
  isLedgerSupported,
  WalletId,
  getAllWallets,
  StellarWallet,
} from "@/lib/wallet";

interface WalletConnectProps {
  onConnectSuccess?: (publicKey: string) => void;
}

type ExtendedWalletId = WalletId | "ledger";

function WalletConnect({ onConnectSuccess }: WalletConnectProps) {
  const { accounts, connectWallet } = useWallet();
  const hasAccounts = accounts.length > 0;
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"idle" | "connecting" | "authenticating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [installWalletName, setInstallWalletName] = useState("Freighter");
  const [installWalletUrl, setInstallWalletUrl] = useState("https://freighter.app");
  const [browser, setBrowser] = useState<"chrome" | "firefox" | "other">("other");
  const [selectedWallet, setSelectedWallet] = useState<ExtendedWalletId>("freighter");
  const [ledgerSupported, setLedgerSupported] = useState(false);
  const [qrUri, setQrUri] = useState<string | null>(null);

  const availableWallets = getAllWallets();

  useEffect(() => {
    setBrowser(detectBrowser());
    isLedgerSupported().then(setLedgerSupported);

    // Listen for WalletConnect QR URI events
    const handleWcUri = (event: Event) => {
      const customEvent = event as CustomEvent<{ uri: string }>;
      if (customEvent.detail?.uri) {
        setQrUri(customEvent.detail.uri);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("walletconnect:uri", handleWcUri);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("walletconnect:uri", handleWcUri);
      }
    };
  }, []);

  const handleConnect = async (walletId: ExtendedWalletId) => {
    setSelectedWallet(walletId);
    setLoading(true);
    setError(null);
    setStep("connecting");
    setQrUri(null);

    if (walletId === "ledger") {
      const { publicKey, error: ledgerError } = await getLedgerPublicKey();
      if (ledgerError || !publicKey) {
        setError(ledgerError || "Could not retrieve public key from Ledger device.");
        setLoading(false);
        setStep("idle");
        return;
      }

      setStep("authenticating");
      const { error: authError } = await performSEP0010Auth(publicKey);
      setLoading(false);
      setStep("idle");

      if (authError) {
        setError(authError);
        return;
      }

      connectWallet(publicKey);
      onConnectSuccess?.(publicKey);
      return;
    }

    // Stellar multi-wallet adapter flow
    if (walletId === "freighter") {
      const installed = await isFreighterInstalled();
      if (!installed) {
        setInstallWalletName("Freighter");
        setInstallWalletUrl(EXTENSION_URLS[browser] || "https://freighter.app");
        setShowInstallPrompt(true);
        setLoading(false);
        setStep("idle");
        return;
      }
    }

    setShowInstallPrompt(false);
    const { publicKey, error: walletError } = await requestWalletConnection(walletId);

    if (walletError || !publicKey) {
      setError(walletError || `Could not connect to ${walletId} wallet.`);
      setLoading(false);
      setStep("idle");
      return;
    }

    setStep("authenticating");
    const { error: authError } = await performSEP0010Auth(publicKey, walletId);
    setLoading(false);
    setStep("idle");

    if (authError) {
      setError(authError);
      return;
    }

    connectWallet(publicKey, walletId);
    onConnectSuccess?.(publicKey);
  };

  const getWalletBadge = (wallet: StellarWallet) => {
    if (wallet.id === "freighter") return "Default";
    if (wallet.id === "albedo") return "Web / No Ext";
    if (wallet.id === "walletconnect") return "Mobile QR";
    return "Extension";
  };

  const storeName =
    browser === "firefox"
      ? "Firefox Add-ons"
      : browser === "chrome"
        ? "Chrome Web Store"
        : "the official website";

  if (showInstallPrompt) {
    return (
      <div className="card max-w-md mx-auto animate-slide-up text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <PuzzleIcon className="w-7 h-7 text-amber-400" />
        </div>

        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">
          {installWalletName} not detected
        </h2>
        <p className="text-slate-600 dark:text-slate-400 text-sm mb-5 leading-relaxed">
          {installWalletName} is required to sign transactions securely in your browser.
        </p>

        <ol className="space-y-3 mb-6 text-sm text-left text-slate-700 dark:text-slate-300">
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-stellar-500/20 border border-stellar-500/30 text-stellar-700 dark:text-stellar-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              1
            </span>
            <span>
              Install {installWalletName} from{" "}
              <a
                href={installWalletUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-stellar-700 dark:text-stellar-400 hover:text-stellar-600 dark:hover:text-stellar-300 underline underline-offset-2 inline-flex items-center gap-1"
              >
                {storeName}
                <ExternalLinkIcon className="w-3 h-3" />
              </a>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-stellar-500/20 border border-stellar-500/30 text-stellar-700 dark:text-stellar-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              2
            </span>
            <span>Create or import your Stellar account in the wallet</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-stellar-500/20 border border-stellar-500/30 text-stellar-700 dark:text-stellar-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              3
            </span>
            <span>Return here and try connecting again</span>
          </li>
        </ol>

        <a
          href={installWalletUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full flex items-center justify-center gap-2 mb-3"
        >
          <ExternalLinkIcon className="w-4 h-4" />
          Get {installWalletName}
        </a>

        <div className="flex gap-2">
          <button
            onClick={() => handleConnect(selectedWallet)}
            disabled={loading}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : "Try Again"}
          </button>
          <button onClick={() => setShowInstallPrompt(false)} className="btn-secondary px-4">
            Choose Other
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card max-w-lg mx-auto text-center animate-slide-up">
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-stellar-500/10 border border-stellar-500/20 flex items-center justify-center">
        <WalletIcon className="w-8 h-8 text-stellar-700 dark:text-stellar-400" />
      </div>

      <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">
        {hasAccounts ? "Add another account" : "Connect your Stellar wallet"}
      </h2>
      <p className="text-slate-600 dark:text-slate-400 text-sm mb-6 leading-relaxed">
        {hasAccounts
          ? "Select a wallet provider to connect and manage alongside your existing accounts."
          : "Choose your preferred wallet to interact with Finchippay on the Stellar network."}
      </p>

      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 text-sm text-left">
          {error}
        </div>
      )}

      {qrUri && selectedWallet === "walletconnect" && (
        <div className="mb-5 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-900 dark:text-white mb-3">
            <QrCodeIcon className="w-5 h-5 text-stellar-500" />
            Scan with LOBSTR or WalletConnect Mobile
          </div>
          <div className="p-3 bg-white rounded-lg inline-block shadow-inner mb-3">
            <div className="font-mono text-xs break-all max-w-xs text-slate-800">
              {qrUri.slice(0, 48)}...
            </div>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Awaiting approval from your mobile wallet...
          </div>
        </div>
      )}

      {/* Provider Picker Grid / List */}
      <div className="space-y-2.5 mb-6 text-left">
        {availableWallets.map((wallet) => {
          const isSelected = selectedWallet === wallet.id;
          const isConnectingThis = isSelected && step === "connecting";
          const isAuthenticatingThis = isSelected && step === "authenticating";

          return (
            <button
              key={wallet.id}
              onClick={() => handleConnect(wallet.id)}
              disabled={loading}
              className={`w-full p-3.5 rounded-xl border flex items-center justify-between transition-all duration-150 ${
                isSelected && loading
                  ? "border-stellar-500 bg-stellar-500/10 shadow-sm"
                  : "border-slate-200 dark:border-white/10 hover:border-stellar-500/60 hover:bg-slate-50 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/5 flex items-center justify-center font-bold text-sm text-stellar-600 dark:text-stellar-400">
                  {wallet.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 dark:text-white text-sm">
                      {wallet.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                      {getWalletBadge(wallet)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                    {wallet.metadata.description}
                  </div>
                </div>
              </div>

              <div className="flex items-center">
                {isConnectingThis ? (
                  <span className="flex items-center gap-1.5 text-xs text-stellar-600 dark:text-stellar-400">
                    <Spinner /> Connecting
                  </span>
                ) : isAuthenticatingThis ? (
                  <span className="flex items-center gap-1.5 text-xs text-stellar-600 dark:text-stellar-400">
                    <Spinner /> Verifying
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                    Connect →
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {/* Ledger Hardware Wallet Option */}
        <button
          onClick={() => handleConnect("ledger")}
          disabled={loading || !ledgerSupported}
          className={`w-full p-3.5 rounded-xl border flex items-center justify-between transition-all duration-150 ${
            selectedWallet === "ledger" && loading
              ? "border-blue-500 bg-blue-500/10 shadow-sm"
              : "border-slate-200 dark:border-white/10 hover:border-blue-500/60 hover:bg-slate-50 dark:hover:bg-white/5"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <LedgerIcon className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900 dark:text-white text-sm">
                  Ledger Hardware
                </span>
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                  Hardware
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Connect your Ledger Nano S / X via WebHID USB
              </div>
            </div>
          </div>

          <div className="flex items-center">
            {selectedWallet === "ledger" && step === "connecting" ? (
              <span className="flex items-center gap-1.5 text-xs text-blue-400">
                <Spinner /> Connecting
              </span>
            ) : selectedWallet === "ledger" && step === "authenticating" ? (
              <span className="flex items-center gap-1.5 text-xs text-blue-400">
                <Spinner /> Verifying
              </span>
            ) : (
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                Connect →
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Network indicator & help */}
      <div className="pt-4 border-t border-slate-200 dark:border-white/5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Network:{" "}
          <span className="font-mono text-slate-700 dark:text-slate-300 uppercase">
            {process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet"}
          </span>
        </div>
        <div>All wallets use SEP-0010 authentication</div>
      </div>
    </div>
  );
}

export default withErrorBoundary(WalletConnect, "WalletConnect");
