import { useState } from "react";
import { exportTransactionsCSV, downloadCSV, ExportOptions } from "@/lib/exportTransactions";

interface ExportModalProps {
  publicKey: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportModal({ publicKey, isOpen, onClose }: ExportModalProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState<"all" | "sent" | "received">("all");
  const [asset, setAsset] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  if (!isOpen) return null;

  const handleExport = async () => {
    setLoading(true);
    setProgress("Fetching transactions...");
    try {
      const options: ExportOptions = { publicKey, type };
      if (startDate) options.startDate = new Date(startDate);
      if (endDate) options.endDate = new Date(endDate);
      if (asset) options.asset = asset;
      setProgress("Generating CSV...");
      const csv = await exportTransactionsCSV(options);
      const filename = `finchippay-export-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCSV(csv, filename);
      onClose();
    } catch (err: unknown) {
      setProgress(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Export Transactions</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as "all" | "sent" | "received")} className="mt-1 w-full rounded border px-3 py-2 text-sm">
              <option value="all">All</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Asset</label>
            <input type="text" value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="XLM, USDC..." className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </div>
          {progress && <p className="text-sm text-gray-600">{progress}</p>}
          <div className="flex gap-2">
            <button onClick={handleExport} disabled={loading} className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? "Exporting..." : "Export CSV"}
            </button>
            <button onClick={onClose} className="rounded border px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
