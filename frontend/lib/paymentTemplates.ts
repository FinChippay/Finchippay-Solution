/**
 * lib/paymentTemplates.ts
 * Encrypted-at-rest store for reusable payment templates.
 *
 * A payment template captures the fields a user commonly re-sends (destination,
 * amount, asset, memo) under a friendly label. Like the address book, templates
 * are encrypted in localStorage with the active wallet session key.
 *
 * This module is intentionally UI-agnostic: it exposes the same
 * load/save/subscribe surface as the address book so a future SendPaymentForm
 * integration can adopt it without touching the encryption layer.
 */

import { createEncryptedStore } from "@/lib/encryptedStorage";

export interface PaymentTemplate {
  id: string;
  label: string;
  destination?: string;
  amount?: string;
  assetCode?: string;
  memo?: string;
  createdAt: number;
  updatedAt: number;
}

const PAYMENT_TEMPLATES_STORAGE_KEY = "finchippay:payment-templates";
const PAYMENT_TEMPLATES_UPDATED_EVENT = "finchippay:payment-templates-updated";

function now() {
  return Date.now();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function makeTemplate(input: unknown): PaymentTemplate | null {
  const raw = (input ?? {}) as Partial<PaymentTemplate>;
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) return null;

  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : now();

  return {
    id: raw.id || `tpl:${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    label,
    destination: optionalString(raw.destination),
    amount: optionalString(raw.amount),
    assetCode: optionalString(raw.assetCode),
    memo: optionalString(raw.memo),
    createdAt,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now(),
  };
}

function dedupeTemplates(templates: PaymentTemplate[]) {
  const seen = new Set<string>();
  return templates.filter((template) => {
    if (seen.has(template.id)) return false;
    seen.add(template.id);
    return true;
  });
}

const store = createEncryptedStore<PaymentTemplate>({
  storageKey: PAYMENT_TEMPLATES_STORAGE_KEY,
  eventName: PAYMENT_TEMPLATES_UPDATED_EVENT,
  revive: makeTemplate,
  dedupe: dedupeTemplates,
});

export function loadPaymentTemplates(): PaymentTemplate[] {
  return store.load();
}

export function savePaymentTemplates(templates: PaymentTemplate[]) {
  store.save(templates);
}

export function upsertPaymentTemplate(
  input: Omit<Partial<PaymentTemplate>, "createdAt" | "updatedAt"> & { label: string }
): PaymentTemplate[] {
  const label = input.label.trim();
  if (!label) throw new Error("Enter a label for this template.");

  const templates = loadPaymentTemplates();
  const timestamp = now();
  const existingIndex = input.id ? templates.findIndex((t) => t.id === input.id) : -1;

  if (existingIndex >= 0) {
    templates[existingIndex] = {
      ...templates[existingIndex],
      ...makeTemplate({ ...templates[existingIndex], ...input, updatedAt: timestamp }),
    } as PaymentTemplate;
  } else {
    const created = makeTemplate({ ...input, createdAt: timestamp, updatedAt: timestamp });
    if (created) templates.unshift(created);
  }

  savePaymentTemplates(templates);
  return templates;
}

export function deletePaymentTemplate(id: string): PaymentTemplate[] {
  const templates = loadPaymentTemplates().filter((template) => template.id !== id);
  savePaymentTemplates(templates);
  return templates;
}

export function subscribeToPaymentTemplates(callback: (templates: PaymentTemplate[]) => void) {
  return store.subscribe(callback);
}

// ─── Session lifecycle (called from the wallet layer) ───────────────────────

export function unlockPaymentTemplates(key: CryptoKey, owner: string) {
  return store.unlock(key, owner);
}

export function reEncryptPaymentTemplates(key: CryptoKey, owner: string) {
  return store.reEncrypt(key, owner);
}

export function lockPaymentTemplates() {
  store.lock();
}

export function clearPaymentTemplates() {
  store.clear();
}
