import { registerClientReset } from "@/lib/soroban";
import {
  FinchippayContractClient,
  EscrowStatus,
  type Escrow,
} from "@/lib/contract-bindings";
import { CONTRACT_ID, submitTransaction, getCurrentLedger } from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";

const CACHE_KEY = "finchippay:escrow-cache";
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  escrows: EscrowRecord[];
  fetchedAt: number;
}

export interface EscrowRecord {
  id: number;
  from: string;
  to: string;
  token: string;
  amount: string;
  releaseLedger: number;
  status: EscrowStatus;
  memo: string;
}

export type EscrowTab = "active" | "completed" | "incoming";

// ─── Escrow Contract Client Singleton ───────────────────────────────────────

let _escrowClient: FinchippayContractClient | null = null;

/**
 * Reset the escrow contract client singleton. Invoked automatically by
 * resetClient() in soroban.ts so a network switch invalidates every cached
 * contract client in one call.
 */
function resetEscrowClient(): void {
  _escrowClient = null;
}

// Register the escrow client reset with the shared reset registry at module load.
registerClientReset(resetEscrowClient);

function getCache(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setCache(key: string, entry: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    const all = getCache();
    all[key] = entry;
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {}
}

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Get or create the escrow contract client singleton.
 *
 * The client is built from the current network configuration. After a network
 * switch, call resetClient() from soroban.ts to invalidate this singleton so the
 * next call builds a fresh client targeting the new RPC/passphrase.
 */
function getClient(): FinchippayContractClient {
  if (!CONTRACT_ID) throw new Error("Contract ID is not configured.");
  if (!_escrowClient) {
    _escrowClient = new FinchippayContractClient(CONTRACT_ID);
  }
  return _escrowClient;
}

export async function getEscrows(publicKey: string, forceRefresh = false): Promise<EscrowRecord[]> {
  if (!CONTRACT_ID) return [];
  const cacheKey = `escrows:${publicKey}`;

  if (!forceRefresh) {
    const cached = getCache()[cacheKey];
    if (cached && isCacheValid(cached)) return cached.escrows;
  }

  try {
    const client = getClient();
    const count = await client.getEscrowCount(publicKey);
    if (count === 0) return [];

    const batchSize = 10;
    const all: EscrowRecord[] = [];

    for (let start = 0; start < count; start += batchSize) {
      const end = Math.min(start + batchSize, count);
      const batch: number[] = [];
      for (let i = start; i < end; i++) batch.push(i);

      const results = await Promise.allSettled(
        batch.map((id) => client.getEscrow(id, publicKey))
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          const escrow = result.value as Escrow;
          if (escrow.from === publicKey || escrow.to === publicKey) {
            all.push(escrow);
          }
        }
      }
    }

    setCache(cacheKey, { escrows: all, fetchedAt: Date.now() });
    return all;
  } catch {
    const cached = getCache()[cacheKey];
    if (cached) return cached.escrows;
    return [];
  }
}

export async function claimEscrow(
  fromPublicKey: string,
  id: number,
): Promise<string> {
  const client = getClient();
  const tx = await client.claimEscrow(fromPublicKey, id);
  const signed = await signTransactionWithWallet(tx.toXDR());
  if (signed.error || !signed.signedXDR) throw new Error(signed.error || "Signing failed");
  const result = await submitTransaction(signed.signedXDR);
  invalidateCacheForUser(fromPublicKey);
  return result.hash || String(id);
}

export async function cancelEscrow(
  fromPublicKey: string,
  id: number,
): Promise<string> {
  const client = getClient();
  const tx = await client.cancelEscrow(fromPublicKey, id);
  const signed = await signTransactionWithWallet(tx.toXDR());
  if (signed.error || !signed.signedXDR) throw new Error(signed.error || "Signing failed");
  const result = await submitTransaction(signed.signedXDR);
  invalidateCacheForUser(fromPublicKey);
  return result.hash || String(id);
}

export async function getEscrowDetail(
  publicKey: string,
  id: number,
): Promise<EscrowRecord | null> {
  if (!CONTRACT_ID) return null;
  try {
    const client = getClient();
    const escrow = await client.getEscrow(id, publicKey);
    return escrow as EscrowRecord | null;
  } catch {
    return null;
  }
}

function invalidateCacheForUser(publicKey: string) {
  const cacheKey = `escrows:${publicKey}`;
  const all = getCache();
  delete all[cacheKey];
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {}
  }
}

export function clearEscrowCache() {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
  }
}

export function categorizeEscrows(escrows: EscrowRecord[], publicKey: string) {
  const active = escrows.filter(
    (e) => e.status === EscrowStatus.Pending && (e.from === publicKey || e.to === publicKey),
  );
  const completed = escrows.filter(
    (e) => e.status === EscrowStatus.Released || e.status === EscrowStatus.Cancelled,
  );
  const incoming = escrows.filter(
    (e) => e.status === EscrowStatus.Pending && e.to === publicKey,
  );
  return { active, completed, incoming };
}

export function sortEscrows(
  escrows: EscrowRecord[],
  sortBy: "time-remaining" | "amount-desc" | "date-created" = "time-remaining",
): EscrowRecord[] {
  const sorted = [...escrows];
  switch (sortBy) {
    case "amount-desc":
      sorted.sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
      break;
    case "date-created":
      sorted.sort((a, b) => b.id - a.id);
      break;
    default:
      sorted.sort((a, b) => a.releaseLedger - b.releaseLedger);
  }
  return sorted;
}

export function filterEscrows(
  escrows: EscrowRecord[],
  query: string,
): EscrowRecord[] {
  if (!query.trim()) return escrows;
  const q = query.toLowerCase();
  return escrows.filter(
    (e) =>
      e.from.toLowerCase().includes(q) ||
      e.to.toLowerCase().includes(q) ||
      String(e.id).includes(q),
  );
}
