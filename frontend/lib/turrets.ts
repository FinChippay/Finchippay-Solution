/**
 * lib/turrets.ts
 * Frontend API helpers for Turrets txFunctions.
 */

import { apiFetch } from "./api";

const API_URL =
  (typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_API_URL) || "http://localhost:4000";

function getBaseUrl(): string {
  return API_URL.replace(/\/+$/, "");
}

function authHeaders(token?: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

export type TurretsType = "dca" | "stop_loss";

export interface TurretsDeployment {
  id: string;
  ownerPublicKey: string;
  type: TurretsType;
  status: "active" | "paused";
  config: Record<string, unknown>;
  deploymentHash: string;
  createdAt: string;
  nextRunAt: string | null;
  lastExecutedAt: string | null;
  lastCheckedAt: string | null;
  lastObservedPriceUsd: number | null;
  lastError: string | null;
}

export interface TurretsExecutionHistory {
  id: string;
  deploymentId: string;
  status: string;
  message: string;
  result: Record<string, unknown> | null;
  createdAt: string;
}

/** Shape returned by the backend for single-resource turrets endpoints. */
interface TurretEnvelope<T> {
  success: boolean;
  data: T;
}

/** Shape returned by the backend for paginated turrets endpoints. */
interface TurretPage<T> {
  success: boolean;
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    total: number | null;
    limit?: number;
  };
}

export async function createTurretsChallenge(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
}) {
  const res = await apiFetch(`${getBaseUrl()}/api/turrets/challenge`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as TurretEnvelope<{
    challengeXDR: string;
    deploymentHash: string;
    normalizedConfig: Record<string, unknown>;
    networkPassphrase: string;
  }>;
  return payload.data;
}

export async function deployTurretsFunction(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
  deploymentHash: string;
  signedChallengeXDR: string;
}) {
  const res = await apiFetch(`${getBaseUrl()}/api/turrets/deploy`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as TurretEnvelope<TurretsDeployment>;
  return payload.data;
}

export async function listTurretsFunctions(ownerPublicKey: string) {
  const res = await apiFetch(
    `${getBaseUrl()}/api/turrets?ownerPublicKey=${encodeURIComponent(ownerPublicKey)}`,
    { headers: authHeaders() },
  );
  const payload = (await res.json()) as TurretPage<TurretsDeployment>;
  return payload.data ?? [];
}

export async function getTurretsHistory(id: string) {
  const res = await apiFetch(`${getBaseUrl()}/api/turrets/${encodeURIComponent(id)}/history`, {
    headers: authHeaders(),
  });
  const payload = (await res.json()) as TurretPage<TurretsExecutionHistory>;
  return payload.data ?? [];
}

export async function pauseTurretsFunction(id: string): Promise<TurretsDeployment> {
  const res = await apiFetch(`${getBaseUrl()}/api/turrets/${encodeURIComponent(id)}/pause`, {
    method: "POST",
    headers: authHeaders(),
  });
  const payload = (await res.json()) as TurretEnvelope<TurretsDeployment>;
  return payload.data;
}

export async function resumeTurretsFunction(id: string): Promise<TurretsDeployment> {
  const res = await apiFetch(`${getBaseUrl()}/api/turrets/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    headers: authHeaders(),
  });
  const payload = (await res.json()) as TurretEnvelope<TurretsDeployment>;
  return payload.data;
}
