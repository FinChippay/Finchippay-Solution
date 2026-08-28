/**
 * @file lib/treasury.ts
 * @description Data layer for the DAO treasury / multi-sig governance UI.
 *
 * Composes the contract's on-chain admin-governance proposals
 * (`get_admin_action_proposal`) and payment multi-sig proposals
 * (`get_multisig`) into a single typed overview for the `/treasury` page.
 *
 * Admin actions are stored with an auto-incrementing counter, so to list them
 * we probe ids from 1..N until the first miss (the contract panics with
 * ProposalNotFound, surfaced as a thrown error by `simulateCall`).
 */

import { FinchippayClient, getClient, type AdminActionProposal, type MultiSigProposal } from "./soroban";

/** Hard cap for the admin-proposal probe to avoid unbounded RPC churn. */
const MAX_ADMIN_PROBE = 200;

export type ProposalKind = "admin" | "payment";

/** A single treasury row, normalising both proposal families. */
export interface TreasuryProposal {
  kind: ProposalKind;
  id: number;
  /** proposer / admin address that created the proposal. */
  proposer: string;
  /** Human label for the action type (admin) or "Payment" (payment multisig). */
  actionType: string;
  /** Raw contract payload for admin actions (empty for payment multisig). */
  actionData: unknown[];
  /** Signer addresses that approved so far. */
  approvals: string[];
  /** Total signer set (payment) or admin signers (admin). */
  signers: string[];
  /** Approvals required to execute. */
  threshold: number;
  /** Status string, normalised to a stable UI token. */
  status: "pending" | "executed" | "cancelled";
  /** Raw contract status for reference. */
  rawStatus: string;
  expirationLedger: number;
  /** Underlying proposal payload. */
  raw: AdminActionProposal | MultiSigProposal;
}

export interface TreasuryOverview {
  proposals: TreasuryProposal[];
  adminSigners: string[];
  adminThreshold: number;
}

/**
 * Probe admin-governance proposals by id until the first miss.
 *
 * The contract keeps `AdminActionCount` monotonically increasing and never
 * deletes proposals, so a contiguous 1..count range is guaranteed. We stop at
 * the first missing id.
 */
export async function fetchAdminProposals(
  client: FinchippayClient,
  caller?: string,
): Promise<AdminActionProposal[]> {
  const proposals: AdminActionProposal[] = [];
  const batchSize = 10;
  let start = 1;
  // Probe in small batches to keep RPC concurrency low; stop on first miss.
  while (start <= MAX_ADMIN_PROBE) {
    const ids = Array.from({ length: batchSize }, (_, i) => start + i);
    const settled = await Promise.all(
      ids.map((id) =>
        client.getAdminActionProposal(id, caller).catch(() => null),
      ),
    );
    const found = settled.filter((p): p is AdminActionProposal => p !== null);
    proposals.push(...found);
    const miss = settled.findIndex((p) => p === null);
    if (miss !== -1) break; // contiguous range exhausted
    start += batchSize;
  }
  return proposals;
}

/**
 * List payment multi-sig proposals 1..count.
 */
export async function fetchPaymentProposals(
  client: FinchippayClient,
  caller?: string,
): Promise<MultiSigProposal[]> {
  const count = await client.getMultisigCount(caller).catch(() => 0);
  const proposals: MultiSigProposal[] = [];
  for (let id = 1; id <= count; id += 1) {
    const p = await client.getMultisig(id, caller).catch(() => null);
    if (p) proposals.push(p);
  }
  return proposals;
}

/** Map a contract status string to a stable UI token. */
export function normalizeStatus(
  status: string,
  executedFallback = false,
): TreasuryProposal["status"] {
  const s = status.toLowerCase();
  if (s === "executed" || executedFallback) return "executed";
  if (s === "cancelled") return "cancelled";
  return "pending";
}

/**
 * Build the full treasury overview for a connected wallet.
 */
export async function fetchTreasuryOverview(
  caller?: string,
  clientOverride?: FinchippayClient,
): Promise<TreasuryOverview> {
  const client = clientOverride ?? getClient();

  const [adminRaw, paymentRaw, adminSigners, adminThreshold] = await Promise.all([
    fetchAdminProposals(client, caller),
    fetchPaymentProposals(client, caller),
    client.getAdminSigners(caller).catch(() => [] as string[]),
    client.getAdminSignersThreshold(caller).catch(() => 1),
  ]);

  const adminProposals: TreasuryProposal[] = adminRaw.map((p) => ({
    kind: "admin",
    id: p.id,
    proposer: p.approvals[0] ?? "",
    actionType: p.actionType,
    actionData: p.actionData,
    approvals: p.approvals,
    signers: adminSigners,
    threshold: p.threshold,
    status: normalizeStatus(p.executed ? "executed" : "pending"),
    rawStatus: p.executed ? "Executed" : "Pending",
    expirationLedger: p.expirationLedger,
    raw: p,
  }));

  const paymentProposals: TreasuryProposal[] = paymentRaw.map((p) => ({
    kind: "payment",
    id: p.id,
    proposer: p.proposer,
    actionType: "payment",
    actionData: [],
    approvals: p.approvals,
    signers: p.signers,
    threshold: p.threshold,
    status: normalizeStatus(p.status),
    rawStatus: p.status,
    expirationLedger: p.expirationLedger,
    raw: p,
  }));

  // Admin actions surfaced first (governance), then payment proposals, both
  // ordered by id descending so the newest shows first.
  const proposals = [...adminProposals, ...paymentProposals].sort(
    (a, b) => (a.kind === b.kind ? b.id - a.id : a.kind === "admin" ? -1 : 1),
  );

  return { proposals, adminSigners, adminThreshold };
}

/** Human-readable labels for known admin action types. */
export const ADMIN_ACTION_LABELS: Record<string, string> = {
  pause: "Pause Contract",
  unpause: "Unpause Contract",
  set_admin_signers: "Update Admin Signers",
  set_pauser: "Update Pauser",
  upgrade: "Upgrade Contract",
  reconcile_balance: "Reconcile Balance",
};
