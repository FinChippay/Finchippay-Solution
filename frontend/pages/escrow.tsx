import Head from "next/head";
/**
 * pages/escrow.tsx
 * Soroban time-locked escrow (issue #213).
 *
 * Create — sender locks XLM into the contract until release_ledger.
 * Claim  — recipient pulls the funds once release_ledger has elapsed.
 * Cancel — sender pulls the funds back, but only before release_ledger.
 */
import { useState, useEffect } from "react";
import WalletConnect from "@/components/WalletConnect";
import { useWallet } from "@/lib/useWallet";
import {
  buildCreateEscrowTransaction,
  buildClaimEscrowTransaction,
  buildCancelEscrowTransaction,
  buildClaimEscrowPartialTransaction,
  getEscrow,
  getCurrentLedger,
  submitTransaction,
  isValidStellarAddress,
  getXLMBalance,
  CONTRACT_ID,
  EscrowRecord,
  STELLAR_STROOPS_PER_XLM,
} from "@/lib/stellar";
import { Horizon } from "@stellar/stellar-sdk";
import { signTransactionWithWallet } from "@/lib/wallet";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; escrow: EscrowRecord; currentLedger: number }
  | { kind: "missing" };

interface EscrowPageProps {
  walletPublicKey?: string | null;
  services?: {
    getXLMBalance?: typeof getXLMBalance;
    getCurrentLedger?: typeof getCurrentLedger;
    getEscrow?: typeof getEscrow;
  };
}

export default function EscrowPage({ walletPublicKey, services }: EscrowPageProps) {
  const { publicKey: connectedPublicKey } = useWallet();
  const publicKey = walletPublicKey === undefined ? connectedPublicKey : walletPublicKey;
  const loadXLMBalance = services?.getXLMBalance ?? getXLMBalance;
  const loadCurrentLedger = services?.getCurrentLedger ?? getCurrentLedger;
  const loadEscrow = services?.getEscrow ?? getEscrow;

  // Create-escrow form state.
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [releaseLedger, setReleaseLedger] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [xlmBalance, setXlmBalance] = useState("0");
  const [latestLedger, setLatestLedger] = useState<number | null>(null);

  // Manage-escrow (claim / cancel) state.
  const [lookupId, setLookupId] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<null | "claim" | "cancel" | "partialClaim">(null);
  const [partialClaimAmount, setPartialClaimAmount] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!publicKey) return;
      try {
        const [bal, ledger] = await Promise.all([
          loadXLMBalance(publicKey),
          loadCurrentLedger(),
        ]);
        if (cancelled) return;
        setXlmBalance(bal);
        setLatestLedger(ledger);
      } catch {
        // Non-fatal — the user can still type values manually.
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadCurrentLedger, loadXLMBalance, publicKey]);

  const isSelfTransfer = Boolean(publicKey && recipient === publicKey);
  const isInvalidAmount = amount !== "" && (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0);
  const isPastLedger = releaseLedger !== "" && latestLedger !== null && parseInt(releaseLedger, 10) <= latestLedger;

  const isCreateDisabled = (() => {
    if (!publicKey) return true;
    if (isSelfTransfer) return true;
    if (!isValidStellarAddress(recipient)) return true;
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return true;
    const parsedLedger = parseInt(releaseLedger, 10);
    if (!Number.isFinite(parsedLedger)) return true;
    if (latestLedger !== null && parsedLedger <= latestLedger) return true;
    return creating;
  })();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) return;
    setCreating(true);
    setCreateError(null);
    setCreatedId(null);
    try {
      const tx = await buildCreateEscrowTransaction({
        fromPublicKey: publicKey,
        toPublicKey: recipient,
        amount,
        releaseLedger: parseInt(releaseLedger, 10),
      });
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Transaction signing was rejected.");
      }
      const result = await submitTransaction(signedXDR);
      // The contract returns the new escrow id as the call return value.
      // Horizon attaches it under result_meta_xdr; we surface it best-effort.
      const returned = (result as Horizon.HorizonApi.SubmitTransactionResponse & { returnValue?: unknown }).returnValue;
      const id = typeof returned === "number" ? returned : null;
      setCreatedId(id);
      setRecipient("");
      setAmount("");
      setReleaseLedger("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create escrow.";
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  }

  async function handleLookup() {
    if (!publicKey) return;
    const id = parseInt(lookupId, 10);
    if (!Number.isFinite(id) || id < 0) {
      setActionError("Enter a non-negative escrow id.");
      return;
    }
    setLookup({ kind: "loading" });
    setActionError(null);
    try {
      const [escrow, ledger] = await Promise.all([
        loadEscrow(publicKey, id),
        loadCurrentLedger(),
      ]);
      if (!escrow) {
        setLookup({ kind: "missing" });
        return;
      }
      setLookup({ kind: "found", escrow, currentLedger: ledger });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Lookup failed.";
      setActionError(message);
      setLookup({ kind: "idle" });
    }
  }

  async function handleAction(action: "claim" | "cancel" | "partialClaim") {
    if (!publicKey || lookup.kind !== "found") return;
    if (action === "cancel" && typeof window !== "undefined" && window.confirm && !window.confirm("Are you sure you want to cancel this escrow?")) {
      return;
    }
    setActionPending(action);
    setActionError(null);
    try {
      let tx: Awaited<ReturnType<typeof buildClaimEscrowTransaction>>;
      if (action === "partialClaim") {
        const partialStroops = Math.round(parseFloat(partialClaimAmount) * STELLAR_STROOPS_PER_XLM);
        if (!Number.isFinite(partialStroops) || partialStroops <= 0) {
          throw new Error("Partial claim amount must be a positive number.");
        }
        const escrowStroops = BigInt(lookup.escrow.amount);
        if (BigInt(partialStroops) > escrowStroops) {
          throw new Error("Partial claim amount exceeds escrow balance.");
        }
        tx = await buildClaimEscrowPartialTransaction(publicKey, lookup.escrow.id, BigInt(partialStroops));
      } else {
        const builder = action === "claim"
          ? buildClaimEscrowTransaction
          : buildCancelEscrowTransaction;
        tx = await builder(publicKey, lookup.escrow.id);
      }
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Transaction signing was rejected.");
      }
      await submitTransaction(signedXDR);
      // Refresh the cached escrow so the UI reflects the new status.
      await handleLookup();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${action} escrow.`;
      setActionError(message);
    } finally {
      setActionPending(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Head>
        <title>Escrow | Finchippay-Solution</title>
        <meta name="description" content="Create, claim, and cancel time-locked Soroban escrow payments on Stellar." />
      </Head>
      <h1 className="mb-2 text-2xl font-semibold">Escrow payments</h1>
      <p className="mb-6 text-sm text-gray-600">
        Lock XLM until a future ledger. Recipient claims on or after the
        release ledger; sender can cancel any time before it.
      </p>

      {!CONTRACT_ID && (
        <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          <strong>NEXT_PUBLIC_CONTRACT_ID</strong> is not configured. Escrow
          calls will fail until a deployed contract id is wired in.
        </div>
      )}

      {!publicKey ? (
        <WalletConnect />
      ) : (
        <>
          <section className="mb-8 rounded-lg border border-gray-200 p-4">
            <h2 className="mb-3 text-lg font-medium">Create escrow</h2>
            <p className="mb-3 text-xs text-gray-500">
              Balance: {xlmBalance} XLM
              {latestLedger !== null && (
                <> · Current ledger: {latestLedger.toLocaleString()}</>
              )}
            </p>
            <form onSubmit={handleCreate} className="space-y-3">
              <label className="block text-sm">
                Recipient address
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="G..."
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs"
                />
              </label>
              <label className="block text-sm">
                Amount (XLM)
                <input
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Release ledger
                <input
                  type="number"
                  min="0"
                  value={releaseLedger}
                  onChange={(e) => setReleaseLedger(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Stellar ledgers close ~5s apart. For a ~1 hour lock,
                  add ~720 to the current ledger.
                </span>
              </label>
              {isSelfTransfer && (
                <p className="text-xs text-red-600">Self-transfer is not allowed.</p>
              )}
              {isInvalidAmount && (
                <p className="text-xs text-red-600">Amount must be a positive number.</p>
              )}
              {isPastLedger && (
                <p className="text-xs text-red-600">Release ledger must be greater than current ledger.</p>
              )}
              {createError && (
                <p className="text-sm text-red-600">{createError}</p>
              )}
              {createdId !== null && (
                <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">
                  Escrow created. Note the id from the transaction return
                  value to claim or cancel later.
                </p>
              )}
              <button
                type="submit"
                disabled={isCreateDisabled}
                className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-300"
              >
                {creating ? "Locking funds…" : "Lock funds in escrow"}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-gray-200 p-4">
            <h2 className="mb-3 text-lg font-medium">Claim or cancel</h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="number"
                min="0"
                placeholder="Escrow id"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                className="flex-1 rounded border border-gray-300 px-3 py-2"
              />
              <button
                type="button"
                onClick={handleLookup}
                disabled={lookup.kind === "loading"}
                className="rounded bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
              >
                {lookup.kind === "loading" ? "Looking up…" : "Look up"}
              </button>
            </div>

            {lookup.kind === "missing" && (
              <p className="mt-3 text-sm text-gray-600">
                No escrow with that id, or the contract returned an error.
              </p>
            )}

            {lookup.kind === "found" && (
              <div className="mt-4 space-y-2 text-sm">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                  <dt className="text-gray-500">Status</dt>
                  <dd>{lookup.escrow.status}</dd>
                  <dt className="text-gray-500">From</dt>
                  <dd className="font-mono text-xs break-all">{lookup.escrow.from}</dd>
                  <dt className="text-gray-500">To</dt>
                  <dd className="font-mono text-xs break-all">{lookup.escrow.to}</dd>
                  <dt className="text-gray-500">Amount</dt>
                  <dd>{lookup.escrow.amount} stroops</dd>
                  <dt className="text-gray-500">Release ledger</dt>
                  <dd>{lookup.escrow.releaseLedger.toLocaleString()}</dd>
                  <dt className="text-gray-500">Current ledger</dt>
                  <dd>{lookup.currentLedger.toLocaleString()}</dd>
                </dl>

                {lookup.escrow.status === "Pending" && (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => handleAction("claim")}
                        disabled={
                          actionPending !== null ||
                          lookup.currentLedger < lookup.escrow.releaseLedger ||
                          publicKey !== lookup.escrow.to
                        }
                        title={
                          publicKey !== lookup.escrow.to
                            ? "Only the recipient can claim"
                            : lookup.currentLedger < lookup.escrow.releaseLedger
                              ? "Release ledger not reached"
                              : ""
                        }
                        className="rounded bg-green-600 px-4 py-2 text-sm text-white disabled:bg-gray-300"
                      >
                        {actionPending === "claim" ? "Claiming…" : "Claim"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction("cancel")}
                        disabled={
                          actionPending !== null ||
                          lookup.currentLedger >= lookup.escrow.releaseLedger ||
                          publicKey !== lookup.escrow.from
                        }
                        title={
                          publicKey !== lookup.escrow.from
                            ? "Only the sender can cancel"
                            : lookup.currentLedger >= lookup.escrow.releaseLedger
                              ? "Release ledger already reached"
                              : ""
                        }
                        className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:bg-gray-300"
                      >
                        {actionPending === "cancel" ? "Cancelling…" : "Cancel"}
                      </button>
                    </div>

                    {/* Partial claim */}
                    <div className="border-t border-gray-200 pt-3">
                      <p className="mb-2 text-xs text-gray-500">
                        Or claim a partial amount (XLM):
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.0000001"
                          placeholder="Partial amount (XLM)"
                          value={partialClaimAmount}
                          onChange={(e) => setPartialClaimAmount(e.target.value)}
                          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleAction("partialClaim")}
                          disabled={
                            actionPending !== null ||
                            lookup.currentLedger < lookup.escrow.releaseLedger ||
                            publicKey !== lookup.escrow.to ||
                            !partialClaimAmount ||
                            parseFloat(partialClaimAmount) <= 0
                          }
                          title={
                            publicKey !== lookup.escrow.to
                              ? "Only the recipient can claim"
                              : lookup.currentLedger < lookup.escrow.releaseLedger
                                ? "Release ledger not reached"
                                : !partialClaimAmount || parseFloat(partialClaimAmount) <= 0
                                  ? "Enter a positive amount"
                                  : ""
                          }
                          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:bg-gray-300"
                        >
                          {actionPending === "partialClaim" ? "Claiming…" : "Partial claim"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {actionError && (
              <p className="mt-3 text-sm text-red-600">{actionError}</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
