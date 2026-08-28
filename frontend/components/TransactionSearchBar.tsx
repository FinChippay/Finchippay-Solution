/**

 * components/TransactionSearchBar.tsx
 * Advanced transaction search with operator support and real-time filtering
 */

import clsx from "clsx";
import { useState, useCallback, useEffect, useRef } from "react";
import { PaymentRecord } from "@/lib/stellar";
import {
  searchPayments,
  SearchResult,
  parseSearchQuery,
  tokenizeText,
} from "@/lib/transactionSearch";
import { buildIndex, saveIndexedDB, loadIndexedDB, invalidate } from "@/lib/transactionSearchIndex";
import { logger } from "@/lib/logger";

interface TransactionSearchBarProps {
  payments: PaymentRecord[];
  onSearchResults: (results: SearchResult[]) => void;
  placeholder?: string;
}

export default function TransactionSearchBar({
  payments,
  onSearchResults,
  placeholder = "Search by memo, address, amount... (from:G... to:G... asset:XLM amount:>100)",
}: TransactionSearchBarProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [indexReady, setIndexReady] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Build and persist index when payments change.
  // Invalidates stale entries so removed payments are un-indexed on refresh.
  useEffect(() => {
    const buildAndPersistIndex = async () => {
      try {
        setIsSearching(true);
        const currentHashes = new Set<string>(payments.map((p) => p.hash));
        const existing = await loadIndexedDB();
        if (existing && existing.size > 0) {
          const indexedHashes = new Set<string>();
          for (const hashes of existing.values()) {
            for (const h of hashes) {
              indexedHashes.add(h);
            }
          }
          const removedHashes = Array.from(indexedHashes).filter(
            (h) => !currentHashes.has(h)
          );
          if (removedHashes.length > 0) {
            await invalidate(removedHashes);
          }
        }
        const index = buildIndex(payments);
        await saveIndexedDB(payments, index);
        setIndexReady(true);
      } catch (error) {
        logger.error("Failed to build search index:", {}, error instanceof Error ? error : undefined);
      } finally {
        setIsSearching(false);
      }
    };

    if (payments.length > 0) {
      buildAndPersistIndex();
    }
  }, [payments]);

  // Perform search with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!query.trim()) {
        onSearchResults([]);
        setSuggestions([]);
        return;
      }

      setIsSearching(true);
      try {
        const results = searchPayments(payments, query);
        onSearchResults(results);

        // Generate suggestions based on current results
        const uniqueMemos = new Set<string>();
        results.forEach((r) => {
          if (r.payment.memo) {
            r.payment.memo.split(/\s+/).forEach((word) => {
              if (word.length > 2) uniqueMemos.add(word);
            });
          }
        });

        setSuggestions(Array.from(uniqueMemos).slice(0, 5));
        setShowSuggestions(true);
      } catch (error) {
        logger.error("Search error:", {}, error instanceof Error ? error : undefined);
      } finally {
        setIsSearching(false);
      }
    }, 100); // Debounce for real-time search ≤100ms

    return () => clearTimeout(timer);
  }, [query, payments, onSearchResults]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setShowSuggestions(true);
    },
    []
  );

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setQuery((prev) => {
      const parts = prev.trim().split(/\s+/);
      // Remove the last word if it's incomplete and add suggestion
      parts.pop();
      return parts.length > 0 ? parts.join(" ") + " " + suggestion : suggestion;
    });
    setShowSuggestions(false);
  }, []);

  const handleClear = useCallback(() => {
    setQuery("");
    onSearchResults([]);
    setSuggestions([]);
    searchInputRef.current?.focus();
  }, [onSearchResults]);

  const parsed = parseSearchQuery(query);
  const hasOperators =
    parsed.from || parsed.to || parsed.asset || parsed.amount;

  return (
    <div className="relative">
      <div className="relative flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder={placeholder}
            className={clsx(
              "input-field w-full pl-10 pr-10",
              isSearching && "opacity-75"
            )}
            aria-label="Search transactions"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            🔍
          </div>
          {query && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {hasOperators && (
          <div className="px-3 py-1 rounded-full bg-stellar-500/10 text-stellar-600 dark:text-stellar-400 text-xs font-medium whitespace-nowrap">
            {[
              parsed.from && "from",
              parsed.to && "to",
              parsed.asset && "asset",
              parsed.amount && "amount",
            ]
              .filter(Boolean)
              .join(" + ")}
          </div>
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50"
        >
          <div className="p-2">
            <p className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1 font-semibold">
              Suggestions
            </p>
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <span className="text-slate-700 dark:text-slate-300">
                  {suggestion}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Help text */}
      {!query && (
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <p>
            💡 <strong>Operators:</strong> from:GXXX | to:GXXX | asset:XLM |
            amount:&gt;100
          </p>
          <p>💡 Try searching by memo, address, or amount for instant results</p>
        </div>
      )}
    </div>
  );
}
