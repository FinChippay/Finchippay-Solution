/**
 * lib/transactionSearch.ts
 * Transaction search utilities for parsing operators and highlighting
 */

import { PaymentRecord } from "./stellar";

export interface SearchOperators {
  from?: string;
  to?: string;
  asset?: string;
  amount?: string;
  memo?: string;
}

export interface SearchResult {
  payment: PaymentRecord;
  relevance: number;
  highlights: {
    memo?: string[];
    address?: string[];
    hash?: string[];
  };
}

/**
 * Parse search query into operators
 * Supports: from:GXXX to:GXXX asset:XLM amount:>100 "memo text"
 */
export function parseSearchQuery(query: string): SearchOperators & { text: string } {
  const operators: SearchOperators = {};
  let text = query;

  // Extract operators
  const fromMatch = text.match(/from:(\S+)/i);
  if (fromMatch) {
    operators.from = fromMatch[1];
    text = text.replace(fromMatch[0], "").trim();
  }

  const toMatch = text.match(/to:(\S+)/i);
  if (toMatch) {
    operators.to = toMatch[1];
    text = text.replace(toMatch[0], "").trim();
  }

  const assetMatch = text.match(/asset:(\S+)/i);
  if (assetMatch) {
    operators.asset = assetMatch[1];
    text = text.replace(assetMatch[0], "").trim();
  }

  const amountMatch = text.match(/amount:([\d.><=!]+)/i);
  if (amountMatch) {
    operators.amount = amountMatch[1];
    text = text.replace(amountMatch[0], "").trim();
  }

  return { ...operators, text: text.trim() };
}

/**
 * Tokenize text for indexing (case-insensitive, split by spaces/punctuation)
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/[^\w-]/g, ""))
    .filter((token) => token.length > 0);
}

/**
 * Check if transaction matches search operators
 */
export function matchesOperators(
  payment: PaymentRecord,
  operators: SearchOperators
): boolean {
  if (operators.from) {
    const from = payment.type === "payment" ? payment.from : "";
    if (!from.toLowerCase().includes(operators.from.toLowerCase())) {
      return false;
    }
  }

  if (operators.to) {
    const to = payment.type === "payment" ? payment.to : "";
    if (!to.toLowerCase().includes(operators.to.toLowerCase())) {
      return false;
    }
  }

  if (operators.asset) {
    const assetCode = payment.asset.split(":")[0];
    if (!assetCode.toLowerCase().includes(operators.asset.toLowerCase())) {
      return false;
    }
  }

  if (operators.amount) {
    const amount = parseFloat(payment.amount);
    if (isNaN(amount)) return false;

    const amountOp = operators.amount;
    if (amountOp.startsWith(">")) {
      if (amount <= parseFloat(amountOp.slice(1))) return false;
    } else if (amountOp.startsWith("<")) {
      if (amount >= parseFloat(amountOp.slice(1))) return false;
    } else if (amountOp.startsWith(">=")) {
      if (amount < parseFloat(amountOp.slice(2))) return false;
    } else if (amountOp.startsWith("<=")) {
      if (amount > parseFloat(amountOp.slice(2))) return false;
    } else if (amountOp.startsWith("=")) {
      if (amount !== parseFloat(amountOp.slice(1))) return false;
    } else {
      if (amount !== parseFloat(amountOp)) return false;
    }
  }

  return true;
}

/**
 * Highlight matching terms in text
 */
export function highlightText(text: string, searchTokens: string[]): string[] {
  if (searchTokens.length === 0) return [];

  const lowerText = text.toLowerCase();
  const highlights: string[] = [];

  for (const token of searchTokens) {
    const lowerToken = token.toLowerCase();
    let index = 0;
    while ((index = lowerText.indexOf(lowerToken, index)) !== -1) {
      highlights.push(text.substring(index, index + token.length));
      index += token.length;
    }
  }

  return highlights;
}

/**
 * Calculate relevance score for search results
 */
export function calculateRelevance(
  payment: PaymentRecord,
  searchTokens: string[]
): number {
  if (searchTokens.length === 0) return 0;

  let score = 0;
  const fields = {
    memo: payment.memo ? payment.memo.toLowerCase() : "",
    from: payment.type === "payment" ? payment.from.toLowerCase() : "",
    to: payment.type === "payment" ? payment.to.toLowerCase() : "",
    hash: payment.hash.toLowerCase(),
    amount: payment.amount,
  };

  for (const token of searchTokens) {
    const lowerToken = token.toLowerCase();

    // Exact match in memo = highest relevance
    if (fields.memo === lowerToken) score += 10;
    // Memo contains token
    else if (fields.memo.includes(lowerToken)) score += 5;

    // Address contains token
    if (fields.from.includes(lowerToken) || fields.to.includes(lowerToken)) score += 3;

    // Hash starts with token (prefix match)
    if (fields.hash.startsWith(lowerToken)) score += 2;
    else if (fields.hash.includes(lowerToken)) score += 1;
  }

  return score;
}

/**
 * Filter payments by search query
 */
export function searchPayments(
  payments: PaymentRecord[],
  query: string
): SearchResult[] {
  if (!query.trim()) return [];

  const parsed = parseSearchQuery(query);
  const searchTokens = tokenizeText(parsed.text);

  const results: SearchResult[] = payments
    .map((payment) => {
      // Check operator matching
      if (!matchesOperators(payment, { ...parsed, text: "" })) {
        return null;
      }

      // Calculate relevance
      const relevance = calculateRelevance(payment, searchTokens);
      if (relevance === 0 && searchTokens.length > 0) return null;

      // Generate highlights
      const highlights = {
        memo: payment.memo ? highlightText(payment.memo, searchTokens) : [],
        address:
          payment.type === "payment"
            ? [
                ...highlightText(payment.from, searchTokens),
                ...highlightText(payment.to, searchTokens),
              ]
            : [],
        hash: highlightText(payment.hash, searchTokens),
      };

      return { payment, relevance, highlights };
    })
    .filter((r) => r !== null) as SearchResult[];

  // Sort by relevance (descending)
  return results.sort((a, b) => b.relevance - a.relevance);
}
