import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { getReceipt, resolveFederationAddress, isValidStellarAddress, type ReceiptMetadata } from "@/lib/stellar";
import ReceiptDetail from "@/components/ReceiptDetail";
import Skeleton from "@/components/Skeleton";

export default function PublicReceiptPage() {
  const router = useRouter();
  const { username, index } = router.query;
  const [receipt, setReceipt] = useState<ReceiptMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;

    const fetchReceipt = async () => {
      try {
        setLoading(true);
        setError(null);

        const identifier = typeof username === "string" ? username : username?.[0] || "";
        const receiptIndex = parseInt(typeof index === "string" ? index : index?.[0] || "0", 10);

        if (!identifier || isNaN(receiptIndex)) {
          throw new Error("Invalid receipt parameters.");
        }

        let address = identifier;
        if (!isValidStellarAddress(identifier)) {
          const resolved = await resolveFederationAddress(identifier);
          if (!resolved) {
            throw new Error("Could not resolve account address.");
          }
          address = resolved;
        }

        const data = await getReceipt(address, receiptIndex);
        if (!data) {
          throw new Error("Receipt not found.");
        }

        setReceipt(data);
      } catch (err: any) {
        console.error("Failed to load receipt:", err);
        setError(err.message || "Failed to load receipt.");
      } finally {
        setLoading(false);
      }
    };

    fetchReceipt();
  }, [router.isReady, username, index]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center">
      <Head>
        <title>Receipt {index} - Finchippay</title>
      </Head>

      <div className="w-full max-w-lg mb-8 text-center">
        <h1 className="text-3xl font-bold text-stellar-700 dark:text-stellar-400">Finchippay</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Verifiable On-Chain Payment Receipt</p>
      </div>

      {loading ? (
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-slate-800">
          <Skeleton height="h-8" width="w-1/2" className="mb-2" />
          <Skeleton height="h-4" width="w-1/3" className="mb-8" />
          <Skeleton height="h-24" width="w-full" className="mb-8 rounded-2xl" />
          <div className="space-y-4">
            <Skeleton height="h-10" width="w-full" />
            <Skeleton height="h-10" width="w-full" />
          </div>
        </div>
      ) : error || !receipt ? (
        <div className="w-full max-w-lg rounded-3xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-500/20 dark:bg-red-500/10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 mb-4">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-red-800 dark:text-red-400 mb-2">Error</h2>
          <p className="text-red-600 dark:text-red-300">{error || "Receipt not found."}</p>
        </div>
      ) : (
        <ReceiptDetail
          index={parseInt(index as string, 10)}
          receipt={receipt}
          username={username as string}
        />
      )}
    </div>
  );
}
