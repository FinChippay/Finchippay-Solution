/**
 * lib/turrets.ts
 * Frontend API helpers for Turrets txFunctions.
 *
 * Uses the @finchippay/sdk client for all API calls.
 */

import { sdk } from "./sdk-instance";
import type {
  TxFunctionChallengeRequest,
  TxFunctionDeployRequest,
  TxFunctionDeployment,
  ExecutionLogEntry,
} from "@finchippay/sdk";

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
  const { data } = await sdk.turrets.createChallenge(params as TxFunctionChallengeRequest);
  return data as {
    challengeXDR: string;
    deploymentHash: string;
    normalizedConfig: Record<string, unknown>;
    networkPassphrase: string;
  };
}

export async function deployTurretsFunction(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
  deploymentHash: string;
  signedChallengeXDR: string;
}) {
  const { data } = await sdk.turrets.deploy(params as TxFunctionDeployRequest);
  return data as TurretsDeployment;
}

export async function listTurretsFunctions(ownerPublicKey: string) {
  const { data } = await sdk.turrets.list({ ownerPublicKey });
  return data as TurretsDeployment[];
}

export async function getTurretsHistory(id: string) {
  const { data } = await sdk.turrets.getHistory(id);
  return data as TurretsExecutionHistory[];
}

export async function pauseTurretsFunction(id: string) {
  await sdk.turrets.pause(id);
}

export async function resumeTurretsFunction(id: string) {
  await sdk.turrets.resume(id);
}
