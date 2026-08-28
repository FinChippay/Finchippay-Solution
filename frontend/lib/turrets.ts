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
  return res.json() as Promise<{
    challengeXDR: string;
    deploymentHash: string;
    normalizedConfig: Record<string, unknown>;
    networkPassphrase: string;
  }>;
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
  return res.json() as Promise<TurretsDeployment>;
}

export async function listTurretsFunctions(ownerPublicKey: string) {
  const res = await apiFetch(
    `${getBaseUrl()}/api/turrets/list?ownerPublicKey=${encodeURIComponent(ownerPublicKey)}`,
    { headers: authHeaders() }
  );
  return res.json() as Promise<TurretsDeployment[]>;
}

export async function getTurretsHistory(id: string) {
  const res = await apiFetch(
    `${getBaseUrl()}/api/turrets/history/${encodeURIComponent(id)}`,
    { headers: authHeaders() }
  );
  return res.json() as Promise<TurretsExecutionHistory[]>;
}

export async function pauseTurretsFunction(id: string) {
  await apiFetch(`${getBaseUrl()}/api/turrets/pause/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: authHeaders(),
  });
}

export async function resumeTurretsFunction(id: string) {
  await apiFetch(`${getBaseUrl()}/api/turrets/resume/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: authHeaders(),
  });
}
