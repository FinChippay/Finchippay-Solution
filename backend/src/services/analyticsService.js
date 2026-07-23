/**
 * src/services/analyticsService.js
 * Business logic for transaction volume analytics.
 * Fetches payment data from Horizon and computes aggregated insights.
 * Uses CacheService (Redis+LRU) with 5-minute TTL.
 */

"use strict";

const stellarService = require("./stellarService");

// Lazy-loaded cache service (avoids circular dependency at parse time)
function getCache() {
  return require("./cacheService");
}

// ─── Cache Configuration ──────────────────────────────────────────────────────

const ANALYTICS_TTL_SECONDS = 5 * 60; // 5 minutes

/**
 * Cache wrapper function using CacheService.
 * @param {string} key
 * @param {Function} fn - async function that returns the data
 */
async function withCache(key, fn) {
  const cache = getCache();
  const cached = await cache.get(key);
  if (cached) return cached;

  const data = await fn();
  await cache.set(key, data, ANALYTICS_TTL_SECONDS);
  return data;
}

// ─── Analytics Functions ──────────────────────────────────────────────────────

/**
 * Get summary analytics for a public key.
 * Returns: total sent, total received, unique counterparties, avg transaction size.
 */
async function getSummary(publicKey) {
  return withCache(`analytics:summary:${publicKey}`, async () => {
    const payments = await stellarService.getPayments(publicKey, { limit: 200 });

    let totalSent = 0;
    let totalReceived = 0;
    const counterparties = new Set();
    let transactionCount = 0;

    for (const payment of payments) {
      const amount = parseFloat(payment.amount);

      if (payment.type === "sent") {
        totalSent += amount;
        counterparties.add(payment.to);
      } else {
        totalReceived += amount;
        counterparties.add(payment.from);
      }
      transactionCount++;
    }

    const totalVolume = totalSent + totalReceived;
    const avgTransactionSize =
      transactionCount > 0 ? (totalVolume / transactionCount).toFixed(7) : "0";

    return {
      publicKey,
      totalSentXLM: totalSent.toFixed(7),
      totalReceivedXLM: totalReceived.toFixed(7),
      uniqueCounterparties: counterparties.size,
      averageTransactionSize: avgTransactionSize,
      totalTransactions: transactionCount,
    };
  });
}

/**
 * Get top 5 recipients by total XLM sent.
 */
async function getTopRecipients(publicKey) {
  return withCache(`analytics:top-recipients:${publicKey}`, async () => {
    const payments = await stellarService.getPayments(publicKey, { limit: 200 });

    // Map to track total sent per recipient
    const recipientTotals = new Map();

    for (const payment of payments) {
      // Only count sent payments
      if (payment.type === "sent") {
        const amount = parseFloat(payment.amount);
        const recipient = payment.to;

        if (recipientTotals.has(recipient)) {
          recipientTotals.set(
            recipient,
            recipientTotals.get(recipient) + amount
          );
        } else {
          recipientTotals.set(recipient, amount);
        }
      }
    }

    // Convert to array and sort by amount (descending)
    const sorted = Array.from(recipientTotals.entries())
      .map(([address, total]) => ({
        address,
        totalXLMSent: total.toFixed(7),
      }))
      .sort((a, b) => parseFloat(b.totalXLMSent) - parseFloat(a.totalXLMSent))
      .slice(0, 5); // Top 5 only

    return {
      publicKey,
      topRecipients: sorted,
      count: sorted.length,
    };
  });
}

/**
 * Get payment activity by day of week.
 * Returns counts for all 7 days (Sunday = 0, ... Saturday = 6).
 */
async function getActivityByDay(publicKey) {
  return withCache(`analytics:activity:${publicKey}`, async () => {
    const payments = await stellarService.getPayments(publicKey, { limit: 200 });

    // Initialize counters for all 7 days
    const dayActivity = {
      0: 0, // Sunday
      1: 0, // Monday
      2: 0, // Tuesday
      3: 0, // Wednesday
      4: 0, // Thursday
      5: 0, // Friday
      6: 0, // Saturday
    };

    // Count transactions by day of week
    for (const payment of payments) {
      const date = new Date(payment.createdAt);
      const dayOfWeek = date.getUTCDay();
      dayActivity[dayOfWeek]++;
    }

    // Convert to array format
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const activity = days.map((dayName, index) => ({
      day: dayName,
      dayIndex: index,
      transactionCount: dayActivity[index],
    }));

    return {
      publicKey,
      activityByDay: activity,
    };
  });
}

/**
 * Clear cached analytics for a specific public key.
 * Used primarily for testing.
 * @param {string} publicKey
 */
async function clearCache(publicKey) {
  const cache = getCache();
  await cache.del(`analytics:summary:${publicKey}`);
  await cache.del(`analytics:top-recipients:${publicKey}`);
  await cache.del(`analytics:activity:${publicKey}`);
}

module.exports = {
  getSummary,
  getTopRecipients,
  getActivityByDay,
  clearCache,
};
