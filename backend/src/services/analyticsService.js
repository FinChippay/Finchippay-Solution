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
 * Get platform-wide receipt count from the on-chain contract.
 * This uses the total_receipt_count() view function from the FinchippayContract.
 * 
 * Note: This requires the Soroban contract to be deployed and accessible.
 * The contract address should be configured via environment variable CONTRACT_ADDRESS.
 * 
 * @returns {Promise<{totalReceiptCount: number}>}
 */
async function getTotalReceiptCount() {
  return withCache("analytics:total-receipt-count", async () => {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    
    if (!contractAddress) {
      // If contract address is not configured, return 0 or throw error
      // For now, we'll return 0 to avoid breaking existing functionality
      return { totalReceiptCount: 0 };
    }

    try {
      // Import soroban-sdk dynamically to avoid issues if not installed
      const { Server } = require("@stellar/soroban-sdk");
      
      const server = new Server(process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org");
      const contract = new Contract(contractAddress);
      
      // Call the total_receipt_count() view function
      const result = await server.simulateTransaction(
        new TransactionBuilder(new Account("GAAAA", "0"), { fee: "100" })
          .addOperation(contract.call("total_receipt_count"))
          .setTimeout(30)
          .build()
      );
      
      const totalReceiptCount = Number(result.result.toXdr("base64"));
      
      return { totalReceiptCount };
    } catch (error) {
      // Log error but don't break the analytics service
      console.error("Failed to fetch total receipt count from contract:", error);
      return { totalReceiptCount: 0 };
    }
  });
}

module.exports = {
  getSummary,
  getTopRecipients,
  getActivityByDay,
  getTotalReceiptCount,
};
