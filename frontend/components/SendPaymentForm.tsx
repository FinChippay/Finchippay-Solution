/**
 * components/SendPaymentForm.tsx
 * Form for sending XLM payments to any Stellar address.
 *
 * Issue #8 - Add a 'Send Max' button tooltip explaining the 1 XLM reserve
 * FinChippay/Finchippay-Solution
 */

import { withErrorBoundary } from "@/components/ErrorBoundary";
import PaymentStatusModal, {
  type PaymentFlowStatus,
  type PaymentStepId,
  type PaymentStepTiming,
} from "@/components/PaymentStatusModal";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { parseStellarURI } from "@/lib/sep0007";
import {
  buildPaymentTransaction,
  buildReceiptMintTransaction,
  buildSorobanTipTransaction,
  explorerUrl,
  fetchNetworkFeeStats,
  isValidFederationAddress,
  isValidStellarAddress,
  resolveFederationAddress,
  server,
  STELLAR_BASE_FEE_XLM,
  STELLAR_MEMO_TEXT_MAX_BYTES,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM,
  submitTransaction,
  truncateMemoText,
} from "@/lib/stellar";
import { MULTISIG_THRESHOLD_XLM } from "@/components/MultiSigFlow";
import { signTransactionWithWallet } from "@/lib/wallet";
import {
  type AddressBookContact,
  loadAddressBookContacts,
  saveAddressBookContacts,
  subscribeToAddressBookContacts,
  upsertAddressBookContact,
} from "@/lib/addressBook";
import { formatXLM, shortenAddress } from "@/utils/format";
import {
  SendIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  StarIcon,
  QrCodeIcon,
  ReceiptIcon,
} from "@/components/icons";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToastContext } from "@/lib/ToastContext";

interface SendPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  usdcBalance?: string | null;
  onSuccess?: (txHash?: string) => void;
  title?: string;
  submitLabel?: string;
  successTitle?: string;
  successMessage?: string;
  assetOptions?: AssetType[];
  hideAssetSelector?: boolean;
  hideDestinationField?: boolean;
  destinationReadOnly?: boolean;
  hideAmountField?: boolean;
  hideMemoField?: boolean;
  accountBalances?: Array<{ code: string; issuer: string; balance: string }>;
  prefill?: {
    destination: string;
    amount: string;
    memo?: string;
    validUntil?: number | null;
    fromHistory?: boolean;
  } | null;
  aiPrefill?: {
    destination: string;
    amount: string;
    memo?: string;
  } | null;
}

type Status = PaymentFlowStatus;
type AssetType = "XLM" | "USDC" | "CUSTOM";

interface CustomAsset {
  code: string;
  issuer: string;
}

const ESTIMATED_NETWORK_FEE = `${STELLAR_BASE_FEE_XLM} XLM`;

const RECENT_RECIPIENTS_KEY = "finchippay:recent-recipients";
const MAX_RECENT = 3;

function createInitialStepTimings(): Record<PaymentStepId, PaymentStepTiming> {
  return {
    building: { startedAt: null, completedAt: null, error: null },
    signing: { startedAt: null, completedAt: null, error: null },
    submitting: { startedAt: null, completedAt: null, error: null },
    confirming: { startedAt: null, completedAt: null, error: null },
  };
}

function SendPaymentForm({
  publicKey,
  xlmBalance,
  usdcBalance,
  onSuccess,
  prefill,
  title,
  submitLabel,
  successTitle,
  successMessage,
  assetOptions = ["XLM", "USDC"],
  hideAssetSelector = false,
  hideDestinationField = false,
  destinationReadOnly = false,
  hideAmountField = false,
  hideMemoField = false,
  accountBalances = [],
}: SendPaymentFormProps) {
  const { t } = useTranslation("common");
  const { addToast } = useToastContext();
  const resolvedTitle = title || t("sendPayment.title");
  const resolvedSuccessTitle = successTitle || t("sendPayment.successTitle");
  const resolvedSuccessMessage = successMessage || t("sendPayment.successMessage");
  const [selectedAsset, setSelectedAsset] = useState<AssetType>("XLM");
  const [networkFeeXlm, setNetworkFeeXlm] = useState(STELLAR_BASE_FEE_XLM);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [isResolvingDestination, setIsResolvingDestination] = useState(false);
  const [destinationResolutionError, setDestinationResolutionError] = useState<string | null>(null);
  const [resolvedPaymentDestination, setResolvedPaymentDestination] = useState<string | null>(null);
  const [customAsset, setCustomAsset] = useState<CustomAsset>({ code: "", issuer: "" });
  const [showCustomAssetForm, setShowCustomAssetForm] = useState(false);
  const [selectedMemoTemplate, setSelectedMemoTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isTipOnChain, setIsTipOnChain] = useState(false);
  const [failedStep, setFailedStep] = useState<PaymentStepId | null>(null);
  const [stepTimings, setStepTimings] = useState<Record<PaymentStepId, PaymentStepTiming>>(
    createInitialStepTimings()
  );
  const [mintingReceipt, setMintingReceipt] = useState(false);
  const [receiptMinted, setReceiptMinted] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [isScannerSupported, setIsScannerSupported] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [destAccountWarning, setDestAccountWarning] = useState<string | null>(null);
  const [isCheckingDest, setIsCheckingDest] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const isDetectingRef = useRef(false);
  const destinationInputRef = useRef<HTMLInputElement | null>(null);

  // Power-user shortcut: press "S" (when not already typing in a field and no
  // modal is open) to jump focus to the destination input (#264).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "s" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]')) {
        return; // don't steal focus from an open dialog
      }
      e.preventDefault();
      destinationInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const checkSupport = async () => {
      if (
        typeof window !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
      ) {
        setIsScannerSupported(true);
      }
    };
    checkSupport();
  }, []);

  const handleDecodedResult = (rawValue: string) => {
    const sepResult = parseStellarURI(rawValue);
    if (sepResult.success && sepResult.data) {
      setDestination(sepResult.data.destination);
      if (sepResult.data.amount) setAmount(sepResult.data.amount);
      if (sepResult.data.memo) setMemo(truncateMemoText(sepResult.data.memo));
      setDestinationResolutionError(null);
      setResolvedPaymentDestination(null);
      closeScanner();
      return;
    }
    if (isValidStellarAddress(rawValue)) {
      setDestination(rawValue);
      setDestinationResolutionError(null);
      setResolvedPaymentDestination(null);
      closeScanner();
      return;
    }
  };

  const handleDecodedResultRef = useRef(handleDecodedResult);
  handleDecodedResultRef.current = handleDecodedResult;

  useEffect(() => {
    if (!isScannerOpen || !videoRef.current) return;

    let controls: IScannerControls | null = null;
    isDetectingRef.current = true;

    const codeReader = new BrowserQRCodeReader();
    codeReader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        (result, _error, ctrl) => {
          if (result && isDetectingRef.current) {
            isDetectingRef.current = false;
            handleDecodedResultRef.current(result.getText());
            ctrl.stop();
          }
        },
      )
      .then((c) => {
        controls = c;
        scannerControlsRef.current = c;
      })
      .catch(() => {
        setScannerError("Camera access denied or not available.");
        setIsScannerOpen(false);
      });

    return () => {
      isDetectingRef.current = false;
      controls?.stop();
      scannerControlsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScannerOpen]);

  const openScanner = () => {
    setIsScannerOpen(true);
    setScannerError(null);
  };

  const closeScanner = () => {
    setIsScannerOpen(false);
    isDetectingRef.current = false;
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop();
      scannerControlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const [recentRecipients, setRecentRecipients] = useState<string[]>(() => {
    try {
      if (typeof window !== "undefined") {
        return JSON.parse(sessionStorage.getItem(RECENT_RECIPIENTS_KEY) ?? "[]");
      }
      return [];
    } catch {
      return [];
    }
  });

  const [contacts, setContacts] = useState<AddressBookContact[]>(loadAddressBookContacts);
  const [isContactsDropdownOpen, setIsContactsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeToAddressBookContacts(setContacts), []);

  const saveContacts = (items: AddressBookContact[]) => {
    setContacts(items);
    saveAddressBookContacts(items);
  };

  const deleteContactByAddress = (address: string) => {
    saveContacts(contacts.filter((contact) => contact.address !== address));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsContactsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const saveRecipient = (address: string) => {
    const updated = [address, ...recentRecipients.filter((a) => a !== address)].slice(0, MAX_RECENT);
    setRecentRecipients(updated);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(updated));
    }
  };

  const clearRecipients = () => {
    setRecentRecipients([]);
    sessionStorage.removeItem(RECENT_RECIPIENTS_KEY);
  };

  const memoTemplates = ["Rent", "Salary", "Invoice", "Gift", "Coffee ☕"];

  const handleMemoTemplateClick = (template: string) => {
    if (selectedMemoTemplate === template) {
      setSelectedMemoTemplate(null);
      setMemo("");
      return;
    }
    setSelectedMemoTemplate(template);
    setMemo(template);
  };

  const handleMemoChange = (value: string) => {
    setMemo(value);
    if (value !== selectedMemoTemplate) {
      setSelectedMemoTemplate(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadFee = async () => {
      try {
        const feeStats = await fetchNetworkFeeStats();
        if (!cancelled) {
          setNetworkFeeXlm(feeStats.baseFeeXlm || STELLAR_BASE_FEE_XLM);
        }
      } catch {
        if (!cancelled) {
          setNetworkFeeXlm(STELLAR_BASE_FEE_XLM);
        }
      }
    };
    loadFee();
    const intervalId = window.setInterval(loadFee, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!prefill) return;
    if (prefill.destination) setDestination(prefill.destination);
    if (prefill.amount) setAmount(prefill.amount);
    if (prefill.memo) setMemo(truncateMemoText(prefill.memo));
    setDestinationResolutionError(null);
    setResolvedPaymentDestination(null);
  }, [prefill]);

  // Debounced federation address resolution on keystroke (#98)
  useEffect(() => {
    const trimmed = destination.trim();
    if (!trimmed || isValidStellarAddress(trimmed)) {
      setResolvedPaymentDestination(null);
      setDestinationResolutionError(null);
      return;
    }
    if (!isValidFederationAddress(trimmed) && !trimmed.includes('*')) {
      setResolvedPaymentDestination(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsResolvingDestination(true);
      setDestinationResolutionError(null);
      try {
        const resolved = await resolveFederationAddress(trimmed);
        setResolvedPaymentDestination(resolved);
      } catch (err: unknown) {
        setDestinationResolutionError(
          err instanceof Error ? err.message : 'Failed to resolve address'
        );
      } finally {
        setIsResolvingDestination(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [destination]);

  // Debounced federation address resolution on keystroke (#98)
  useEffect(() => {
    const trimmed = destination.trim();
    if (!trimmed || isValidStellarAddress(trimmed)) {
      setResolvedPaymentDestination(null);
      setDestinationResolutionError(null);
      return;
    }
    if (!isValidFederationAddress(trimmed) && !trimmed.includes('*')) {
      setResolvedPaymentDestination(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsResolvingDestination(true);
      setDestinationResolutionError(null);
      try {
        const resolved = await resolveFederationAddress(trimmed);
        setResolvedPaymentDestination(resolved);
      } catch (err: unknown) {
        setDestinationResolutionError(
          err instanceof Error ? err.message : 'Failed to resolve address'
        );
      } finally {
        setIsResolvingDestination(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [destination]);

  // Pre-validate destination account existence on the Stellar network (#294)
  useEffect(() => {
    if (!isValidStellarAddress(destination)) {
      setDestAccountWarning(null);
      return;
    }
    let cancelled = false;
    setIsCheckingDest(true);
    setDestAccountWarning(null);
    server.loadAccount(destination)
      .then(() => {
        if (!cancelled) setDestAccountWarning(null);
      })
      .catch(() => {
        if (!cancelled) {
          setDestAccountWarning(
            selectedAsset === "XLM"
              ? "This account doesn't exist yet. Sending ≥ 1 XLM will create it."
              : "This account doesn't exist on the Stellar network."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingDest(false);
      });
    return () => { cancelled = true; };
  }, [destination, selectedAsset]);

  const xlmBal = parseFloat(xlmBalance);
  const usdcBal = usdcBalance ? parseFloat(usdcBalance) : 0;
  const customBal = accountBalances.find((b) => b.code === selectedAsset)
    ? parseFloat(accountBalances.find((b) => b.code === selectedAsset)!.balance)
    : 0;
  const balance =
    selectedAsset === "XLM" ? xlmBal : selectedAsset === "USDC" ? usdcBal : customBal;
  const maxSend =
    selectedAsset === "XLM"
      ? Math.max(0, xlmBal - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM)
      : selectedAsset === "USDC"
      ? usdcBal
      : customBal;

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum > 0;
  const estimatedTotalDeducted = hasAmount ? amountNum + networkFeeXlm : null;
  const trimmedDestination = destination.trim();
  const isValidDest = trimmedDestination.length > 0 && isValidStellarAddress(trimmedDestination);
  const isFederationDestination =
    trimmedDestination.length > 0 && isValidFederationAddress(trimmedDestination);
  const isUsernameDestination =
    /^@?[a-zA-Z0-9]{3,20}$/.test(trimmedDestination) &&
    !isValidDest &&
    !isFederationDestination;
  
  const MIN_STROOP = 0.0000001;
  const isValidAmt =
    !Number.isNaN(amountNum) &&
    amountNum >= MIN_STROOP &&
    amountNum <= maxSend &&
    !/[eE]/.test(amount);
  
  const memoBytes = new TextEncoder().encode(memo).length;
  const isMemoValid = memoBytes <= 28;
  
  const canSubmit =
    (isValidDest || isFederationDestination || isUsernameDestination) &&
    !isResolvingDestination &&
    !destinationResolutionError &&
    isValidAmt &&
    status === "idle" &&
    trimmedDestination !== publicKey &&
    isMemoValid;

  const resolveUsername = async (username: string): Promise<string> => {
    const cleanUsername = username.replace(/^@/, "").toLowerCase();
    if (!/^[a-zA-Z0-9]{3,20}$/.test(cleanUsername)) {
      throw new Error("Invalid username format");
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
    const response = await fetch(`${apiBase}/api/accounts/resolve/${encodeURIComponent(cleanUsername)}`);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Username not found");
    }

    if (payload?.success && isValidStellarAddress(payload?.data?.publicKey || "")) {
      return payload.data.publicKey;
    }

    throw new Error("Username resolution did not return a valid public key");
  };

  const resolveDestinationForPayment = async (): Promise<string> => {
    setDestinationResolutionError(null);

    if (isValidDest) {
      return trimmedDestination;
    }

    setIsResolvingDestination(true);
    try {
      if (isFederationDestination) {
        return await resolveFederationAddress(trimmedDestination);
      }

      if (isUsernameDestination) {
        return await resolveUsername(trimmedDestination);
      }

      throw new Error("Enter a valid Stellar public key, federation address, or username.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve destination";
      setDestinationResolutionError(message);
      throw err;
    } finally {
      setIsResolvingDestination(false);
    }
  };

  const contactMatches = contacts.filter((contact) => {
    const query = destination.trim().toLowerCase();
    if (!query) return true;
    return (
      contact.nickname.toLowerCase().includes(query) ||
      contact.address.toLowerCase().includes(query)
    );
  });

  const handleSelectContact = (address: string) => {
    setDestination(address);
    setDestinationResolutionError(null);
    setResolvedPaymentDestination(null);
    setIsContactsDropdownOpen(false);
  };

  const startTracker = () => {
    setIsStatusModalOpen(true);
    setError(null);
    setTxHash(null);
    setFailedStep(null);
    setResolvedPaymentDestination(null);
    setStepTimings(createInitialStepTimings());
  };

  const markStepStarted = (step: PaymentStepId) => {
    const now = Date.now();
    setStepTimings((prev) => ({
      ...prev,
      [step]: { ...prev[step], startedAt: now },
    }));
  };

  const markStepCompleted = (step: PaymentStepId) => {
    const now = Date.now();
    setStepTimings((prev) => ({
      ...prev,
      [step]: { ...prev[step], completedAt: now },
    }));
  };

  const markStepFailed = (step: PaymentStepId, message: string) => {
    const now = Date.now();
    setFailedStep(step);
    setStepTimings((prev) => ({
      ...prev,
      [step]: { ...prev[step], error: message },
    }));
  };

  const closeStatusModal = () => {
    setIsStatusModalOpen(false);
    if (status === "success") {
      setDestination("");
      setAmount("");
      setMemo("");
      setResolvedPaymentDestination(null);
    }
    setStatus("idle");
  };

  const mintNftReceipt = async () => {
    if (!txHash) return;
    setMintingReceipt(true);
    setReceiptError(null);
    try {
      const tx = await buildReceiptMintTransaction({
        fromPublicKey: publicKey,
        toPublicKey: resolvedPaymentDestination || trimmedDestination,
        amount: amountNum.toFixed(7),
        memo: memo.trim() || undefined,
      });
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) throw new Error(signError || "Receipt signing failed");
      const result = await submitTransaction(signedXDR);
      setReceiptMinted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to mint receipt";
      setReceiptError(message);
    } finally {
      setMintingReceipt(false);
    }
  };

  const executeSend = async () => {
    if (!canSubmit) return;
    startTracker();
    let activeStep: PaymentStepId = "building";
    try {
      markStepStarted("building");
      setStatus("building");
      const paymentDestination = await resolveDestinationForPayment();
      if (paymentDestination === publicKey) {
        throw new Error("Destination cannot be your own wallet.");
      }
      setResolvedPaymentDestination(paymentDestination);

      const customAssetEntry = accountBalances.find((b) => b.code === selectedAsset);
      const assetParam: "XLM" | "USDC" | { code: string; issuer: string } =
        selectedAsset === "XLM"
          ? "XLM"
          : selectedAsset === "USDC"
          ? "USDC"
          : customAssetEntry
          ? { code: customAssetEntry.code, issuer: customAssetEntry.issuer }
          : "XLM";

      const tx = isTipOnChain
        ? await buildSorobanTipTransaction({
          fromPublicKey: publicKey,
          toPublicKey: paymentDestination,
          amount: amountNum.toFixed(7),
        })
        : await buildPaymentTransaction({
            fromPublicKey: publicKey,
            toPublicKey: paymentDestination,
            amount: amountNum.toFixed(7),
            memo: memo.trim() || undefined,
            asset: assetParam,
          });
      markStepCompleted("building");

      activeStep = "signing";
      markStepStarted("signing");
      setStatus("signing");
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) throw new Error(signError || "Signing failed");
      markStepCompleted("signing");

      activeStep = "submitting";
      markStepStarted("submitting");
      setStatus("submitting");
      const result = await submitTransaction(signedXDR);
      setTxHash(result.hash);
      markStepCompleted("submitting");

      activeStep = "confirming";
      markStepStarted("confirming");
      setStatus("confirming");
      await waitForTransactionConfirmation(result.hash);
      markStepCompleted("confirming");

      setStatus("success");
      saveRecipient(trimmedDestination);
      addToast(`Payment sent! Tx: ${result.hash.slice(0, 8)}…`, "success");
      onSuccess?.(result.hash);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      markStepFailed(activeStep, message);
      setStatus("error");
      addToast(message, "error", () => { setStatus("idle"); void executeSend(); });
    }
  };

  const waitForTransactionConfirmation = async (hash: string) => {
    let confirmed = false;
    let attempts = 0;
    while (!confirmed && attempts < 10) {
      try {
        await server.transactions().transaction(hash).call();
        confirmed = true;
      } catch (e) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!confirmed) throw new Error("Transaction confirmation timed out.");
  };

  const setMaxAmount = () => setAmount(maxSend.toFixed(7));

  const openConfirmation = () => {
    if (!canSubmit) return;
    setIsConfirmOpen(true);
  };

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!txHash) return;
    try {
      await navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };
  if (status === "success" && txHash) {
    const truncatedHash = `${txHash.slice(0, 12)}…${txHash.slice(-6)}`;
    return (
      <div className="card text-center animate-slide-up relative overflow-hidden">
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
             <div key={i} className="confetti-piece" style={{ left: `${i * 10}%`, animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stellar-500/20 text-stellar-700 dark:text-stellar-400">
          <CheckIcon className="h-8 w-8" />
        </div>
        <h2 className="mb-2 font-display text-2xl font-bold text-slate-900 dark:text-white">{resolvedSuccessTitle}</h2>
        <p className="mb-6 text-slate-600 dark:text-slate-400">{resolvedSuccessMessage}</p>

        <div className="mb-8 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/5 p-4">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("sendPayment.transactionHash")}</p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-xs text-stellar-700 dark:text-stellar-300">{truncatedHash}</code>
            <button onClick={handleCopy} className="text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
              {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>


        <div className="flex flex-col gap-3">
          <a href={explorerUrl(txHash) ?? undefined} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center justify-center gap-2">
            {t("sendPayment.viewOnExplorer")} <ExternalLinkIcon className="h-4 w-4" />
          </a>

          {!receiptMinted ? (
            <button
              onClick={() => void mintNftReceipt()}
              disabled={mintingReceipt}
              className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mintingReceipt ? (
                <>
                  <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                  {t("sendPayment.mintingReceipt")}
                </>
              ) : (
                <>
                  <ReceiptIcon className="h-4 w-4" />
                  {t("sendPayment.mintNftReceipt")}
                </>
              )}
            </button>
          ) : (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 text-center">
              {t("sendPayment.nftReceiptMinted")}
            </div>
          )}

          {receiptError && (
            <p className="text-xs text-red-400 text-center">{receiptError}</p>
          )}

          <button onClick={() => setStatus("idle")} className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
            {t("sendPayment.sendAnother")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
        <SendIcon className="w-5 h-5 text-stellar-700 dark:text-stellar-400" />
        {resolvedTitle}
      </h2>

      <div className="space-y-5">
        {!hideAssetSelector && (
          <div className="flex flex-wrap gap-2">
            {assetOptions.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => { setSelectedAsset(a); setAmount(""); }}
                disabled={a === "USDC" && !usdcBalance}
                className={clsx(
                  "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                  selectedAsset === a
                    ? "bg-stellar-500/15 text-stellar-700 dark:text-stellar-300 border-stellar-500/30"
                    : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20",
                  a === "USDC" && !usdcBalance && "opacity-40 cursor-not-allowed"
                )}
              >
                {a}
              </button>
            ))}
            {accountBalances.map((b) => (
              <button
                key={b.code}
                type="button"
                onClick={() => { setSelectedAsset(b.code as AssetType); setAmount(""); }}
                className={clsx(
                  "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                  selectedAsset === b.code
                    ? "bg-stellar-500/15 text-stellar-700 dark:text-stellar-300 border-stellar-500/30"
                    : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
                )}
              >
                {b.code}
              </button>
            ))}
          </div>
        )}

        {!hideDestinationField && (
          <div className="relative" ref={dropdownRef}>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">{t("sendPayment.destination")}</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsContactsDropdownOpen(!isContactsDropdownOpen)}
                  className="text-xs text-stellar-700 dark:text-stellar-400 hover:text-stellar-600 dark:hover:text-stellar-300"
                >
                  {isContactsDropdownOpen ? t("sendPayment.close") : t("sendPayment.contacts")}
                </button>
                {isValidDest && (
                  <button
                    type="button"
                    onClick={() => {
                      const existing = contacts.find((contact) => contact.address === destination);
                      if (existing) deleteContactByAddress(destination);
                      else {
                        const nickname = prompt("Nickname for this contact:", destination.slice(0, 8));
                        if (nickname) setContacts(upsertAddressBookContact({ nickname, address: destination }));
                      }
                    }}
                    className="text-stellar-700 dark:text-stellar-400 hover:text-stellar-600 dark:hover:text-stellar-300"
                    title={contacts.some((contact) => contact.address === destination) ? t("sendPayment.removeContact") : t("sendPayment.saveContact")}
                    aria-label={contacts.some((contact) => contact.address === destination) ? "Remove address from contacts" : "Save address as contact"}
                  >
                    <StarIcon className="h-5 w-5" filled={contacts.some((contact) => contact.address === destination)} />
                  </button>
                )}
                {isScannerSupported && status === "idle" && (
                  <button
                    type="button"
                    onClick={openScanner}
                    className="md:hidden text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    title="Scan QR Code"
                    aria-label="Scan QR code to fill destination address"
                  >
                    <QrCodeIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
            
            <input
              ref={destinationInputRef}
              type="text"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setDestinationResolutionError(null);
                setResolvedPaymentDestination(null);
                setDestAccountWarning(null);
                setIsContactsDropdownOpen(true);
              }}
              onFocus={() => setIsContactsDropdownOpen(true)}
              placeholder="G..., alice*domain.com, or @username"
              className={clsx(
                "input-field font-mono text-sm",
                destination &&
                  !isValidDest &&
                  !isFederationDestination &&
                  !isUsernameDestination &&
                  "border-red-500/50"
              )}
              disabled={status !== "idle" || destinationReadOnly}
            />

            {destinationResolutionError && (
              <p className="mt-2 text-xs text-red-400">{destinationResolutionError}</p>
            )}

            {/* Destination account existence warning (#294) */}
            {isCheckingDest && isValidDest && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("sendPayment.checkingAccount")}</p>
            )}
            {!isCheckingDest && destAccountWarning && (
              <p className="mt-1 text-xs text-amber-400">{destAccountWarning}</p>
            )}

            {isContactsDropdownOpen && contactMatches.length > 0 && (
              <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-1 shadow-2xl">
                {contactMatches.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectContact(item.address)}
                    className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-200">{item.nickname}</span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">{shortenAddress(item.address, 8)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!hideAmountField && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">{t("sendPayment.amount")} ({selectedAsset})</label>
              <button type="button" onClick={setMaxAmount} className="text-xs text-stellar-700 dark:text-stellar-400 hover:text-stellar-600 dark:hover:text-stellar-300" disabled={status !== "idle"}>
                {t("sendPayment.max")}: {formatXLM(maxSend)}
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "e" || e.key === "E") e.preventDefault();
              }}
              placeholder="0.0000000"
              className={clsx("input-field", amount && !isValidAmt && "border-red-500/50")}
              disabled={status !== "idle"}
            />
          </div>
        )}

        {!hideMemoField && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">{t("sendPayment.memo")}</label>
              <span className={clsx("text-xs transition-colors", memoBytes > 28 ? "text-red-400 font-bold" : "text-slate-600 dark:text-slate-400")}>
                {memoBytes}/28 {t("sendPayment.bytes")}
              </span>
            </div>
            <input
              type="text"
              value={memo}
              onChange={(e) => handleMemoChange(e.target.value)}
              placeholder="Payment note..."
              className={clsx("input-field", memoBytes > 28 && "border-red-500/50")}
              disabled={status !== "idle"}
            />
            {memoBytes > 28 && (
              <p className="mt-1 text-xs text-red-400">{t("sendPayment.memoLimit")}</p>
            )}
          </div>
        )}

        <button
          onClick={openConfirmation}
          disabled={!canSubmit || status !== "idle"}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {status === "idle" ? `${t("sendPayment.send")} ${amount || ""} ${selectedAsset}` : t("sendPayment.processing")}
        </button>

        {/* High-value warning — suggest multi-sig for large payments */}
        {hasAmount && amountNum >= MULTISIG_THRESHOLD_XLM && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-300">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span>
              {t("sendPayment.highValueWarning", { threshold: MULTISIG_THRESHOLD_XLM })}
            </span>
          </div>
        )}
      </div>
    </div>

      <SendConfirmationModal
        isOpen={isConfirmOpen}
        destination={destination}
        amount={amountNum}
        asset={selectedAsset}
        memo={memo}
        estimatedFee={ESTIMATED_NETWORK_FEE}
        isTipOnChain={isTipOnChain}
        t={t as any}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => { setIsConfirmOpen(false); executeSend(); }}
      />

      {isScannerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="QR code scanner">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">Scan QR Code</h3>
              <button onClick={closeScanner} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5" aria-label="Close scanner">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="relative aspect-square bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-white/30 rounded-2xl" />
              </div>
            </div>
            {scannerError && (
              <div className="px-4 py-3 text-sm text-red-400 text-center">{scannerError}</div>
            )}
            <div className="px-4 py-3 text-center">
              <p className="text-xs text-slate-600 dark:text-slate-400">Point your camera at a Stellar QR code</p>
            </div>
          </div>
        </div>
      )}

      <PaymentStatusModal
        isOpen={isStatusModalOpen}
        status={status}
        txHash={txHash}
        error={error}
        failedStep={failedStep}
        stepTimings={stepTimings}
        timeoutSeconds={60}
        onClose={closeStatusModal}
      />
    </>
  );
}

interface SendConfirmationModalProps {
  isOpen: boolean;
  destination: string;
  amount: number;
  asset: AssetType;
  memo: string;
  estimatedFee: string;
  isTipOnChain: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}

function SendConfirmationModal({ isOpen, destination, amount, asset, memo, estimatedFee, isTipOnChain, onCancel, onConfirm, t }: SendConfirmationModalProps) {
  if (!isOpen) return null;
  const shortened = shortenAddress(destination, 8);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-payment-title">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 border border-slate-200 dark:border-white/10 shadow-2xl">
        <h3 id="confirm-payment-title" className="text-xl font-bold text-slate-900 dark:text-white mb-4">{t("sendPayment.confirmPayment")}</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 uppercase font-bold">{t("sendPayment.to")}</p>
            <p className="text-base font-semibold text-slate-900 dark:text-white">{shortened}</p>
            <p className="text-xs font-mono text-slate-600 dark:text-slate-400 break-all mt-0.5">{destination}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">{t("sendPayment.amount")}</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{amount} {asset}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 uppercase font-bold">{t("sendPayment.estimatedFee")}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{estimatedFee}</p>
            </div>
          </div>
          {memo && (
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 uppercase font-bold">{t("sendPayment.memo")}</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{memo}</p>
            </div>
          )}
        </div>
        <div className="mt-8 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 py-3 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-all">{t("nav.cancel")}</button>
          <button onClick={onConfirm} className="flex-1 btn-primary py-3">{t("sendPayment.confirmAndSign")}</button>
        </div>
      </div>
    </div>
  );
}

export default withErrorBoundary(SendPaymentForm, "SendPaymentForm");
