import { useEffect, useState, useCallback } from "react";
import Head from "next/head";
import { useWallet } from "@/lib/useWallet";
import { getReceiptCount, getReceipt, type ReceiptMetadata } from "@/lib/stellar";
import ReceiptCard from "@/components/ReceiptCard";
import ReceiptDetail from "@/components/ReceiptDetail";
import Skeleton from "@/components/Skeleton";
import { useTranslation } from "react-i18next";

export default function ReceiptsPage() {
  const { t } = useTranslation("common");
  const { publicKey } = useWallet();
  const [receipts, setReceipts] = useState<{ index: number; receipt: ReceiptMetadata }[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedReceiptIndex, setSelectedReceiptIndex] = useState<number | null>(null);

  const PAGE_SIZE = 20;

  const fetchReceipts = useCallback(async (startPage: number, currentReceipts: any[] = []) => {
    if (!publicKey) return;
    try {
      setLoading(true);
      const count = await getReceiptCount(publicKey);
      setTotalCount(count);

      if (count === 0) {
        setReceipts([]);
        setLoading(false);
        return;
      }

      // Fetch descending (newest first)
      const startIdx = count - 1 - (startPage - 1) * PAGE_SIZE;
      const endIdx = Math.max(0, startIdx - PAGE_SIZE + 1);

      if (startIdx < 0) {
        setLoading(false);
        return; // No more
      }

      const promises = [];
      for (let i = startIdx; i >= endIdx; i--) {
        promises.push(
          getReceipt(publicKey, i).then(res => {
            if (res) return { index: i, receipt: res };
            return null;
          })
        );
      }

      const results = await Promise.all(promises);
      const validResults = results.filter(Boolean) as { index: number; receipt: ReceiptMetadata }[];

      setReceipts(startPage === 1 ? validResults : [...currentReceipts, ...validResults]);
    } catch (err) {
      console.error("Failed to fetch receipts:", err);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (publicKey) {
      setPage(1);
      fetchReceipts(1, []);
    } else {
      setReceipts([]);
      setLoading(false);
    }
  }, [publicKey, fetchReceipts]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchReceipts(nextPage, receipts);
  };

  const selectedReceipt = selectedReceiptIndex !== null 
    ? receipts.find(r => r.index === selectedReceiptIndex) 
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Head>
        <title>NFT Receipts - Finchippay</title>
      </Head>

      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">
          NFT Receipts
        </h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          View and share your immutable on-chain payment receipts.
        </p>
      </div>

      {!publicKey ? (
        <div className="card text-center p-12">
          <p className="text-slate-600 dark:text-slate-400">Please connect your wallet to view receipts.</p>
        </div>
      ) : loading && receipts.length === 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-white/20 bg-white/5 p-5 dark:border-white/5">
              <Skeleton height="h-6" width="w-1/3" className="mb-4" />
              <Skeleton height="h-8" width="w-1/2" className="mb-6" />
              <div className="space-y-2">
                <Skeleton height="h-4" width="w-full" />
                <Skeleton height="h-4" width="w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <div className="card text-center py-20 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-cosmos-900">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stellar-500/10 text-stellar-700 dark:text-stellar-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">No receipts minted yet.</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            You can mint NFT receipts when sending payments. Check the "Mint NFT Receipt" option next time you send XLM!
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {receipts.map(({ index, receipt }) => (
              <ReceiptCard
                key={index}
                index={index}
                receipt={receipt}
                onViewDetails={setSelectedReceiptIndex}
              />
            ))}
          </div>

          {receipts.length < totalCount && (
            <div className="mt-8 text-center">
              <button
                onClick={loadMore}
                disabled={loading}
                className="btn-secondary"
              >
                {loading ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}

      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <ReceiptDetail
            index={selectedReceipt.index}
            receipt={selectedReceipt.receipt}
            username={publicKey!}
            onClose={() => setSelectedReceiptIndex(null)}
          />
        </div>
      )}
    </div>
  );
}
