import { useMemo, useState } from "react";
import BatchSummary from "@/components/BatchSummary";
import CSVUpload from "@/components/CSVUpload";
import PaymentBuilder, { type BuilderRecipient } from "@/components/PaymentBuilder";
import QuickAddPanel from "@/components/QuickAddPanel";
import { useContacts } from "@/hooks/useContacts";
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
  usdcBalance?: string | null;
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
    token: AVAILABLE_TOKENS[0],
    status: "idle",
  };
}

export default function BatchPaymentForm({
  publicKey,
  xlmBalance,
  usdcBalance,
  onBatchSuccess,
  services,
}: BatchPaymentFormProps) {
  const { contacts, groups, getContactsByGroup } = useContacts();
  const [recipients, setRecipients] = useState<BatchRecipient[]>([createRecipient()]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [useBuilderMode, setUseBuilderMode] = useState(false);
  const [builderRecipients, setBuilderRecipients] = useState<BuilderRecipient[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [distributionMode, setDistributionMode] = useState<"per-recipient" | "total">("per-recipient");
  const [groupTotalAmount, setGroupTotalAmount] = useState("");
  const [showCSVUpload, setShowCSVUpload] = useState(false);

  const handleCSVImport = (rows: Array<{ recipient?: string; amount?: string; asset?: string; memo?: string; isValid?: boolean }>) => {
    const validRows = rows.filter((r) => r.isValid !== false && r.recipient && r.amount);
    if (validRows.length === 0) return;
    const newRecipients = validRows.slice(0, MAX_RECIPIENTS).map((row) => ({
      ...createRecipient(),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      address: row.recipient || "",
      amount: row.amount || "",
      memo: row.memo || "",
      token: AVAILABLE_TOKENS.find((t) => t.code === row.asset) || AVAILABLE_TOKENS[0],
      status: "idle" as RecipientStatus,
    }));
    setRecipients(newRecipients);
    setShowCSVUpload(false);
  };

  const xlmBalanceValue = parseFloat(xlmBalance || "0");
  const availableXLM = Math.max(0, xlmBalanceValue - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM);

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
  const _hasPending = recipients.some((recipient) => recipient.status === "pending");
  const canSubmit =
    !isProcessing &&
    recipients.some(
      (r) => isValidStellarAddress(r.address) && parseFloat(r.amount) > 0 && r.address !== publicKey
    );
  const exceedsBalance = totalXLM > availableXLM;

  const updateRecipient = (id: string, update: Partial<BatchRecipient>) => {
    setRecipients((current) =>
      current.map((r) => (r.id === id ? { ...r, ...update } : r))
    );
  };

  const handleAddRecipient = () => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    setRecipients((current) => [...current, createRecipient()]);
    setBatchMessage(null);
  };

  const handleRemoveRecipient = (id: string) => {
    setRecipients((current) => current.filter((r) => r.id !== id));
    setBatchMessage(null);
  };

  const handleGroupSelect = async (groupId: string) => {
    const gid = parseInt(groupId, 10);
    if (isNaN(gid)) {
      setSelectedGroupId(null);
      return;
    }
    setSelectedGroupId(gid);
    const groupContacts = await getContactsByGroup(gid);
    const newRecipients = groupContacts.map((c) => ({
      ...createRecipient(),
      id: `${Date.now()}-${c.id}`,
      address: c.publicKey,
      memo: c.memo || "",
    }));
    const remaining = MAX_RECIPIENTS - newRecipients.length;
    if (remaining > 0) {
      newRecipients.push(createRecipient());
    }
    setRecipients(newRecipients.slice(0, MAX_RECIPIENTS));
  };

  const handleApplyGroupAmount = () => {
    if (!selectedGroupId) return;
    const amount = parseFloat(groupTotalAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const groupRecipients = recipients.filter((r) => r.address);
    if (groupRecipients.length === 0) return;
    if (distributionMode === "per-recipient") {
      setRecipients((current) =>
        current.map((r) => (r.address ? { ...r, amount: groupTotalAmount } : r))
      );
    } else {
      const perRecipient = amount / groupRecipients.length;
      setRecipients((current) =>
        current.map((r) => (r.address ? { ...r, amount: perRecipient.toFixed(7) } : r))
      );
    }
  };

  const validateRecipient = (recipient: BatchRecipient) => {
    const amount = parseFloat(recipient.amount);
    if (!isValidStellarAddress(recipient.address)) return "Invalid Stellar address.";
    if (!Number.isFinite(amount) || amount <= 0) return "Amount must be greater than 0.";
    if (recipient.address === publicKey) return "Recipient address cannot be the same as your wallet.";
    return null;
  };

  const processRows = async (retryOnlyFailed = false) => {
    setBatchMessage(null);
    setIsProcessing(true);
    const nextRecipients = recipients.map((r) => ({ ...r }));
    setRecipients(nextRecipients);
    for (const recipient of nextRecipients) {
      if (recipient.status === "success") continue;
      if (retryOnlyFailed && recipient.status !== "failed") continue;
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
        const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
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
    const failedRows = nextRecipients.some((r) => r.status === "failed");
    const successRows = nextRecipients.some((r) => r.status === "success");
    if (!failedRows) setBatchMessage("Batch payment complete.");
    else if (successRows) setBatchMessage("Batch completed with some failures. Retry individual failed payments below.");
  };

  const handleSendBatch = async () => { await processRows(false); };
  const handleRetryFailed = async () => { if (!hasFailed) return; await processRows(true); };

  const recipientCount = recipients.length;
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const groupMemberCount = selectedGroupId ? contacts.filter((c) => (c.groupIds || []).includes(selectedGroupId)).length : 0;

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Batch Send</h2>
          <p className="text-sm text-slate-400">Send multiple tokens (XLM, USDC) to up to {MAX_RECIPIENTS} recipients.</p>
        </div>
        <div className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{recipientCount} / {MAX_RECIPIENTS}</div>
      </div>

      {/* Group selection */}
      {groups.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-3 mb-3">
            <svg className="w-5 h-5 text-stellar-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            <span className="text-sm font-medium text-white">Select Group</span>
            {selectedGroup && (
              <span className="text-xs text-slate-400">
                {groupMemberCount} member{groupMemberCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => handleGroupSelect(String(g.id!))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  selectedGroupId === g.id
                    ? "bg-stellar-500/20 text-stellar-300 border-stellar-500/30"
                    : "bg-white/5 text-slate-400 border-white/10 hover:bg-white/10"
                }`}
                style={selectedGroupId === g.id ? { borderColor: g.color } : undefined}
              >
                {g.name}
              </button>
            ))}
            {selectedGroupId && (
              <button
                onClick={() => setSelectedGroupId(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-colors"
              >Clear</button>
            )}
          </div>
          {selectedGroup && (
            <div className="flex items-center gap-2">
              <select
                value={distributionMode}
                onChange={(e) => setDistributionMode(e.target.value as "per-recipient" | "total")}
                className="px-2 py-1 rounded text-xs bg-white/5 border border-white/10 text-slate-300"
              >
                <option value="per-recipient">Amount per recipient</option>
                <option value="total">Total distribution</option>
              </select>
              <input
                type="number"
                step="0.0000001"
                min="0"
                value={groupTotalAmount}
                onChange={(e) => setGroupTotalAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 px-2 py-1 rounded text-xs bg-white/5 border border-white/10 text-white placeholder:text-slate-500"
              />
              <button
                onClick={handleApplyGroupAmount}
                disabled={!groupTotalAmount || parseFloat(groupTotalAmount) <= 0}
                className="px-3 py-1 rounded text-xs font-medium bg-stellar-500/20 text-stellar-300 border border-stellar-500/30 hover:bg-stellar-500/30 transition-colors disabled:opacity-40"
              >Apply</button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {recipients.map((recipient) => (
          <div key={recipient.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="label">Token</span>
                  <select
                    value={recipient.token.code}
                    onChange={(event) => {
                      const selectedToken = AVAILABLE_TOKENS.find((t) => t.code === event.target.value);
                      if (selectedToken) updateRecipient(recipient.id, { token: selectedToken });
                    }}
                    disabled={isProcessing}
                    className="input-field w-full"
                  >
                    {AVAILABLE_TOKENS.map((token) => (
                      <option key={token.code} value={token.code}>{token.code}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Recipient address</span>
                  <input
                    type="text"
                    value={recipient.address}
                    onChange={(event) => updateRecipient(recipient.id, { address: event.target.value })}
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
                    onChange={(event) => updateRecipient(recipient.id, { amount: event.target.value })}
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
                  onChange={(event) => updateRecipient(recipient.id, { memo: truncateMemoText(event.target.value) })}
                  disabled={isProcessing}
                  className="input-field w-full"
                  placeholder="Payment note"
                  maxLength={STELLAR_MEMO_TEXT_MAX_BYTES}
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-300">
                  Status:{" "}
                  {recipient.status === "idle" && <span className="text-slate-400">Waiting</span>}
                  {recipient.status === "pending" && <span className="text-amber-300">Processing</span>}
                  {recipient.status === "success" && <span className="text-emerald-400">Sent ✓</span>}
                  {recipient.status === "failed" && <span className="text-rose-400">Failed</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRemoveRecipient(recipient.id)}
                    disabled={isProcessing || recipients.length <= 1}
                    className="text-xs text-slate-400 hover:text-white disabled:opacity-50"
                  >Remove</button>
                </div>
              </div>
              {recipient.error && (
                <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-100">{recipient.error}</div>
              )}
            </div>
          </div>
        ))}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] items-center">
          <button
            type="button"
            onClick={handleAddRecipient}
            disabled={isProcessing || recipients.length >= MAX_RECIPIENTS}
            className="btn-secondary w-full py-2.5"
          >Add recipient</button>
          <button
            type="button"
            onClick={() => setShowCSVUpload(!showCSVUpload)}
            disabled={isProcessing}
            className="btn-outline py-2.5 px-4 text-xs font-semibold"
          >Import CSV</button>
          <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            Total:{" "}
            <span className="font-semibold text-white">
              {Object.entries(totalByToken).map(([token, amount]) => `${(amount as number).toFixed(7)} ${token}`).join(", ")}
            </span>
          </div>
        </div>

        {showCSVUpload && (
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
            <h3 className="text-sm font-semibold text-white mb-3">Import from CSV</h3>
            <CSVUpload
              onImport={handleCSVImport}
              onCancel={() => setShowCSVUpload(false)}
            />
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setUseBuilderMode(!useBuilderMode)}
            className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors"
          >
            {useBuilderMode ? "Switch to form mode" : "Switch to drag-and-drop builder"}
          </button>
        </div>

        {useBuilderMode && (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <PaymentBuilder
                publicKey={publicKey}
                onRecipientsChange={(bRecipients) => {
                  setBuilderRecipients(bRecipients);
                  const synced = bRecipients
                    .filter((r) => r.address && r.amount)
                    .map((r) => {
                      const existing = recipients.find((er) => er.id === r.id);
                      return {
                        id: r.id,
                        address: r.address,
                        amount: r.amount,
                        memo: r.memo,
                        token: { code: r.token.code, issuer: r.token.issuer, type: r.token.code === "XLM" ? "XLM" as const : "USDC" as const },
                        status: existing?.status || ("idle" as RecipientStatus),
                        error: existing?.error,
                        transactionHash: existing?.transactionHash,
                      };
                    });
                  setRecipients(synced);
                }}
              />
            </div>
            <div className="space-y-4">
              <QuickAddPanel xlmBalance={xlmBalance} usdcBalance={usdcBalance} />
              <BatchSummary
                recipients={builderRecipients.map((r) => ({ token: { code: r.token.code, issuer: r.token.issuer }, amount: r.amount, address: r.address }))}
                maxRecipients={MAX_RECIPIENTS}
              />
            </div>
          </div>
        )}

        {exceedsBalance ? (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-100">
            Total exceeds your available XLM balance after reserve.
          </div>
        ) : null}

        {batchMessage && (
          <div className="rounded-2xl bg-slate-800/70 border border-slate-700 px-4 py-3 text-sm text-slate-200">{batchMessage}</div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleSendBatch}
            disabled={!canSubmit || isProcessing || exceedsBalance}
            className="btn-primary w-full sm:w-auto py-2.5"
          >{isProcessing ? "Sending batch..." : "Send batch"}</button>
          <button
            type="button"
            onClick={handleRetryFailed}
            disabled={!hasFailed || isProcessing}
            className="btn-outline w-full sm:w-auto py-2.5"
          >Retry failed payments</button>
        </div>
      </div>
    </div>
  );
}
