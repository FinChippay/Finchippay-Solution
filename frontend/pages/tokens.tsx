import { useState, useEffect } from "react";
import { getKnownAssets, buildAddTrustlineTx, AssetInfo } from "@/lib/assetDiscovery";
import { signTransactionWithWallet } from "@/lib/wallet";
import TokenCard from "@/components/TokenCard";
import Navbar from "@/components/Navbar";

export default function TokensPage() {
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [search, setSearch] = useState("");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    const key = localStorage.getItem("publicKey");
    setPublicKey(key);
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    getKnownAssets(publicKey)
      .then(setAssets)
      .finally(() => setLoading(false));
  }, [publicKey]);

  const handleAddTrustline = async (code: string, issuer: string) => {
    if (!publicKey) return;
    try {
      const xdr = await buildAddTrustlineTx(publicKey, code, issuer);
      await signTransactionWithWallet(xdr);
      setFeedback({ type: "success", msg: `Trustline added for ${code}` });
      const updated = await getKnownAssets(publicKey);
      setAssets(updated);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Failed to add trustline",
      });
    }
  };

  const filtered = assets.filter(
    (a) =>
      a.code.toLowerCase().includes(search.toLowerCase()) ||
      a.issuer.toLowerCase().includes(search.toLowerCase()) ||
      a.domain?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">Token Browser</h1>
        <input
          type="text"
          placeholder="Search by code, issuer, or domain..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-6 w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {feedback && (
          <div
            className={`mb-4 rounded-lg px-4 py-2 text-sm ${
              feedback.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-600"
            }`}
          >
            {feedback.msg}
          </div>
        )}
        {loading ? (
          <p className="text-gray-500">Loading assets...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500">No assets found.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((asset) => (
              <TokenCard
                key={`${asset.code}-${asset.issuer}`}
                asset={asset}
                onAddTrustline={handleAddTrustline}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
