import { useMemo, useState } from "react";
import {
  buildPaymentTransaction,
  isValidStellarAddress,
  STELLAR_MEMO_TEXT_MAX_BYTES,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM,
  submitTransaction,
  truncateMemoText,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";

const MAX_RECIPIENTS = 10;

// Supported token types for batch payments
type TokenType = "XLM" | "USDC" | "custom";

type TokenInfo = {
  code: string;
  issuer?: string;
  type: TokenType;
};

const AVAILABLE_TOKENS: TokenInfo[] = [
  { code: "XLM", type: "XLM" },
  { code: "USDC", issuer: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B", type: "USDC" },
];

type RecipientStatus = "idle" | "pending" | "success" | "failed";

type BatchRecipient = {
  id: string;
  address: string;
  amount: string;
  memo: string;
  token: TokenInfo;
  status: RecipientStatus;
  error?: string;
  transactionHash?: string;
};

interface BatchPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  onBatchSuccess?: () => void;
  services?: {
    buildPaymentTransaction?: typeof buildPaymentTransaction;
  };
}

function createRecipient(): BatchRecipient {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    address: "",
    amount: "",
    memo: "",
    token: AVAILABLE_TOKENS[0], // Default to XLM
    status: "idle",
  };
}

export default function BatchPaymentForm({
  publicKey,
  xlmBalance,
  onBatchSuccess,
  services,
}: BatchPaymentFormProps) {
  const [recipients, setRecipients] = useState<BatchRecipient[]>([
    createRecipient(),
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  const xlmBalanceValue = parseFloat(xlmBalance || "0");
  const availableXLM = Math.max(
    0,
    xlmBalanceValue - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM
  );

  const totalByToken = useMemo(() => {
    const totals: Record<string, number> = {};
    recipients.forEach((recipient) => {
      const amount = parseFloat(recipient.amount);
      if (Number.isFinite(amount) && amount > 0) {
        const tokenCode = recipient.token.code;
        totals[tokenCode] = (totals[tokenCode] || 0) + amount;
      }
    });
    return totals;
  }, [recipients]);

  const totalXLM = totalByToken["XLM"] || 0;

  const hasFailed = recipients.some((recipient) => recipient.status === "failed");
  const hasPending = recipients.some((recipient) => recipient.status === "pending");
  const hasSuccess = recipients.some((recipient) => recipient.status === "success");
  const canSubmit =
    !isProcessing &&
    recipients.some(
      (recipient) =>
        isValidStellarAddress(recipient.address) &&
        parseFloat(recipient.amount) > 0 &&
        recipient.address !== publicKey
    );
  const exceedsBalance = totalXLM > availableXLM;

  const updateRecipient = (
    id: string,
    update: Partial<BatchRecipient>
  ) => {
    setRecipients((current) =>
      current.map((recipient) =>
        recipient.id === id ? { ...recipient, ...update } : recipient
      )
    );
  };

  const handleAddRecipient = () => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    setRecipients((current) => [...current, createRecipient()]);
    setBatchMessage(null);
  };

  const handleRemoveRecipient = (id: string) => {
    setRecipients((current) => current.filter((recipient) => recipient.id !== id));
    setBatchMessage(null);
  };

  const validateRecipient = (recipient: BatchRecipient) => {
    const amount = parseFloat(recipient.amount);
    if (!isValidStellarAddress(recipient.address)) {
      return "Invalid Stellar address.";
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return "Amount must be greater than 0.";
    }
    if (recipient.address === publicKey) {
      return "Recipient address cannot be the same as your wallet.";
    }
    return null;
  };

  const processRows = async (retryOnlyFailed = false) => {
    setBatchMessage(null);
    setIsProcessing(true);

    let nextRecipients = recipients.map((recipient) => ({ ...recipient }));
    setRecipients(nextRecipients);

    for (const recipient of nextRecipients) {
      if (recipient.status === "success") {
        continue;
      }
      if (retryOnlyFailed && recipient.status !== "failed") {
        continue;
      }

      const validationError = validateRecipient(recipient);
      if (validationError) {
        recipient.status = "failed";
        recipient.error = validationError;
        setRecipients([...nextRecipients]);
        continue;
      }

      recipient.status = "pending";
      recipient.error = undefined;
      setRecipients([...nextRecipients]);

      try {
        const tx = await (services?.buildPaymentTransaction ?? buildPaymentTransaction)({
          fromPublicKey: publicKey,
          toPublicKey: recipient.address,
          amount: parseFloat(recipient.amount).toFixed(7),
          memo: recipient.memo.trim() || undefined,
        });

        const { signedXDR, error: signError } =
          await signTransactionWithWallet(tx.toXDR());

        if (signError || !signedXDR) {
          recipient.status = "failed";
          recipient.error = signError || "Transaction signing was rejected.";
          setRecipients([...nextRecipients]);
          continue;
        }

        const result = await submitTransaction(signedXDR);

        recipient.status = "success";
        recipient.error = undefined;
        recipient.transactionHash = result.hash;
        setRecipients([...nextRecipients]);

        onBatchSuccess?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Batch payment failed.";
        recipient.status = "failed";
        recipient.error = message;
        setRecipients([...nextRecipients]);
      }
    }

    setIsProcessing(false);
    const failedRows = nextRecipients.some((recipient) => recipient.status === "failed");
    const successRows = nextRecipients.some((recipient) => recipient.status === "success");

    if (!failedRows) {
      setBatchMessage("Batch payment complete.");
    } else if (successRows) {
      setBatchMessage(
        "Batch completed with some failures. Retry individual failed payments below."
      );
    }
  };

  const handleSendBatch = async () => {
    await processRows(false);
  };

  const handleRetryFailed = async () => {
    if (!hasFailed) return;
    await processRows(true);
  };

  const recipientCount = recipients.length;

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Batch Send
          </h2>
          <p className="text-sm text-slate-400">
            Send multiple tokens (XLM, USDC) to up to {MAX_RECIPIENTS} recipients in a single transaction.
          </p>
        </div>
        <div className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
          {recipientCount} / {MAX_RECIPIENTS}
        </div>
      </div>

      <div className="space-y-4">
        {recipients.map((recipient, index) => (
          <div
            key={recipient.id}
            className="rounded-3xl border border-white/10 bg-white/5 p-4"
          >
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="label">Token</span>
                  <select
                    value={recipient.token.code}
                    onChange={(event) => {
                      const selectedToken = AVAILABLE_TOKENS.find(
                        (t) => t.code === event.target.value
                      );
                      if (selectedToken) {
                        updateRecipient(recipient.id, {
                          token: selectedToken,
                        });
                      }
                    }}
                    disabled={isProcessing}
                    className="input-field w-full"
                  >
                    {AVAILABLE_TOKENS.map((token) => (
                      <option key={token.code} value={token.code}>
                        {token.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Recipient address</span>
                  <input
                    type="text"
                    value={recipient.address}
                    onChange={(event) =>
                      updateRecipient(recipient.id, {
                        address: event.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="input-field w-full"
                    placeholder="G..."
                  />
                </label>
                <label className="block">
                  <span className="label">Amount ({recipient.token.code})</span>
                  <input
                    type="number"
                    step="0.0000001"
                    min="0"
                    value={recipient.amount}
                    onChange={(event) =>
                      updateRecipient(recipient.id, {
                        amount: event.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="input-field w-full"
                    placeholder="0.5"
                  />
                </label>
              </div>

              <label className="block">
                <span className="label">Memo (optional)</span>
                <input
                  type="text"
                  value={recipient.memo}
                  onChange={(event) =>
                    updateRecipient(recipient.id, {
                      memo: truncateMemoText(event.target.value),
                    })
                  }
                  disabled={isProcessing}
                  className="input-field w-full"
                  placeholder="Payment note"
                  maxLength={STELLAR_MEMO_TEXT_MAX_BYTES}
                />
              </label>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-300">
                  Status: 
                  {recipient.status === "idle" && (
                    <span className="text-slate-400">Waiting</span>
                  )}
                  {recipient.status === "pending" && (
                    <span className="text-amber-300">Processing</span>
                  )}
                  {recipient.status === "success" && (
                    <span className="text-emerald-400">Sent ✓</span>
                  )}
                  {recipient.status === "failed" && (
                    <span className="text-rose-400">Failed</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRemoveRecipient(recipient.id)}
                    disabled={isProcessing || recipients.length <= 1}
                    className="text-xs text-slate-400 hover:text-white disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {recipient.error && (
                <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-100">
                  {recipient.error}
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-center">
          <button
            type="button"
            onClick={handleAddRecipient}
            disabled={isProcessing || recipients.length >= MAX_RECIPIENTS}
            className="btn-secondary w-full py-2.5"
          >
            Add recipient
          </button>
          <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            Total:{" "}
            <span className="font-semibold text-white">
              {Object.entries(totalByToken)
                .map(([token, amount]) => `${(amount as number).toFixed(7)} ${token}`)
                .join(", ")}
            </span>
          </div>
        </div>

        {exceedsBalance ? (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-100">
            Total exceeds your available XLM balance after reserve.
          </div>
        ) : null}

        {batchMessage && (
          <div className="rounded-2xl bg-slate-800/70 border border-slate-700 px-4 py-3 text-sm text-slate-200">
            {batchMessage}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleSendBatch}
            disabled={!canSubmit || isProcessing || exceedsBalance}
            className="btn-primary w-full sm:w-auto py-2.5"
          >
            {isProcessing ? "Sending batch..." : "Send batch"}
          </button>
          <button
            type="button"
            onClick={handleRetryFailed}
            disabled={!hasFailed || isProcessing}
            className="btn-outline w-full sm:w-auto py-2.5"
          >
            Retry failed payments
          </button>
        </div>
      </div>
    </div>
  );
}
