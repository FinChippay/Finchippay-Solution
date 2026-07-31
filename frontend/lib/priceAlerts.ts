/**
 * lib/priceAlerts.ts
 *
 * Price alert system for Stellar assets.
 *
 * Features:
 * - CRUD helpers for alerts stored in localStorage
 * - CoinGecko price polling (every 60 s)
 * - Browser Notification API integration
 * - Callback-based architecture so React components can subscribe to updates
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Notification | MDN Notification API}
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported Stellar assets for price alerts. */
export type AlertAsset = "XLM" | "USDC" | string;

/** Whether the alert fires when the price goes above or below the threshold. */
export type AlertCondition = "above" | "below";

/** Where the user wants to receive the notification. */
export type NotificationPreference = "browser" | "in-app" | "both";

/** A single price alert created by the user. */
export interface PriceAlert {
  id: string;
  asset: AlertAsset;
  condition: AlertCondition;
  threshold: number;
  notificationPreference: NotificationPreference;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of when the alert was triggered (null = not yet triggered). */
  triggeredAt: string | null;
  /** Last known price at the time of triggering. */
  triggeredPrice: number | null;
  /** Whether the alert is still active (false once triggered). */
  active: boolean;
}

/** A snapshot returned by the price poller. */
export interface PriceSnapshot {
  asset: AlertAsset;
  priceUsd: number;
  fetchedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRICE_ALERTS_STORAGE_KEY = "finchippay:price-alerts";

/** Poll interval in milliseconds. */
export const POLL_INTERVAL_MS = 60_000;

/**
 * CoinGecko asset IDs for the supported tokens.
 * Extend this map to add more tokens.
 */
export const COINGECKO_ID_MAP: Record<string, string> = {
  XLM: "stellar",
  USDC: "usd-coin",
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

/** Load all alerts from localStorage. Returns an empty array on error. */
export function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRICE_ALERTS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PriceAlert[];
  } catch {
    return [];
  }
}

/** Persist the given alerts array to localStorage. */
export function saveAlerts(alerts: PriceAlert[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRICE_ALERTS_STORAGE_KEY, JSON.stringify(alerts));
}

/** Add a new alert. Returns the created alert. */
export function createAlert(
  params: Omit<PriceAlert, "id" | "createdAt" | "triggeredAt" | "triggeredPrice" | "active">
): PriceAlert {
  const alert: PriceAlert = {
    ...params,
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    triggeredPrice: null,
    active: true,
  };
  const existing = loadAlerts();
  saveAlerts([...existing, alert]);
  return alert;
}

/** Delete an alert by id. */
export function deleteAlert(id: string): void {
  const alerts = loadAlerts().filter((a) => a.id !== id);
  saveAlerts(alerts);
}

/** Mark an alert as triggered at the given price and deactivate it. */
export function triggerAlert(id: string, priceUsd: number): PriceAlert | null {
  const alerts = loadAlerts();
  const idx = alerts.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  const updated: PriceAlert = {
    ...alerts[idx],
    active: false,
    triggeredAt: new Date().toISOString(),
    triggeredPrice: priceUsd,
  };
  alerts[idx] = updated;
  saveAlerts(alerts);
  return updated;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

/**
 * Request browser notification permission.
 * Returns true if granted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Fire a browser notification for a triggered price alert.
 * Falls back silently if notifications are not supported or not granted.
 */
export function firePriceAlertNotification(alert: PriceAlert, priceUsd: number): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const conditionText = alert.condition === "above" ? "above" : "below";
  const title = `${alert.asset} Price Alert`;
  const body = `${alert.asset} is now $${priceUsd.toFixed(6)} — ${conditionText} your threshold of $${alert.threshold.toFixed(6)}`;

  try {
    // Use service worker showNotification when available (Push API path).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration
            .showNotification(title, {
              body,
              icon: "/favicon.svg",
              badge: "/favicon.svg",
              tag: `price-alert-${alert.id}`,
            })
            .catch(() => {
              // SW notification failed — fall back to Notification constructor.
              new Notification(title, { body, icon: "/favicon.svg" });
            });
        })
        .catch(() => {
          new Notification(title, { body, icon: "/favicon.svg" });
        });
    } else {
      new Notification(title, { body, icon: "/favicon.svg" });
    }
  } catch {
    // Notification API unavailable in this environment — ignore.
  }
}

// ─── Price fetching ───────────────────────────────────────────────────────────

/**
 * Fetch current USD prices for one or more assets from CoinGecko.
 * Returns a map of assetCode → price (USD).
 */
export async function fetchPrices(
  assets: AlertAsset[]
): Promise<Record<string, number>> {
  const ids = [...new Set(assets.map((a) => COINGECKO_ID_MAP[a]).filter(Boolean))];
  if (ids.length === 0) return {};

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);

  const data = (await res.json()) as Record<string, { usd?: number }>;

  const result: Record<string, number> = {};
  for (const asset of assets) {
    const geckoId = COINGECKO_ID_MAP[asset];
    if (geckoId && data[geckoId]?.usd !== undefined) {
      result[asset] = data[geckoId].usd as number;
    }
  }
  return result;
}

// ─── Polling engine ───────────────────────────────────────────────────────────

export type AlertTriggeredCallback = (alert: PriceAlert, priceUsd: number) => void;

/**
 * Start polling prices and evaluating active alerts.
 *
 * @param onTriggered - Called for each alert that crosses its threshold.
 * @param intervalMs  - Polling interval in milliseconds (default: 60 s).
 * @returns A cleanup function that stops the poller.
 */
export function startPriceAlertPoller(
  onTriggered: AlertTriggeredCallback,
  intervalMs: number = POLL_INTERVAL_MS
): () => void {
  let cancelled = false;

  const poll = async () => {
    if (cancelled) return;

    const alerts = loadAlerts().filter((a) => a.active);
    if (alerts.length === 0) return;

    const assets = [...new Set(alerts.map((a) => a.asset))];

    let prices: Record<string, number>;
    try {
      prices = await fetchPrices(assets);
    } catch {
      // Network error — skip this tick.
      return;
    }

    for (const alert of alerts) {
      const price = prices[alert.asset];
      if (price === undefined) continue;

      const crossed =
        (alert.condition === "above" && price > alert.threshold) ||
        (alert.condition === "below" && price < alert.threshold);

      if (crossed) {
        const updated = triggerAlert(alert.id, price);
        if (!updated) continue;

        const pref = alert.notificationPreference;
        if (pref === "browser" || pref === "both") {
          firePriceAlertNotification(alert, price);
        }

        onTriggered(updated, price);
      }
    }
  };

  // Run immediately, then on interval.
  void poll();
  const timerId = window.setInterval(() => void poll(), intervalMs);

  return () => {
    cancelled = true;
    window.clearInterval(timerId);
  };
}
