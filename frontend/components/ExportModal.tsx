import { useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
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
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: onClose });

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl focus:outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="export-modal-title" className="text-lg font-semibold">Export Transactions</h2>
          <button
            onClick={onClose}
            aria-label="Close export dialog"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor="export-start-date" className="block text-sm font-medium">Start Date</label>
            <input id="export-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="export-end-date" className="block text-sm font-medium">End Date</label>
            <input id="export-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="export-type" className="block text-sm font-medium">Type</label>
            <select id="export-type" value={type} onChange={(e) => setType(e.target.value as "all" | "sent" | "received")} className="mt-1 w-full rounded border px-3 py-2 text-sm">
              <option value="all">All</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </select>
          </div>
          <div>
            <label htmlFor="export-asset" className="block text-sm font-medium">Asset</label>
            <input id="export-asset" type="text" value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="XLM, USDC..." className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </div>
          {progress && <p role="status" aria-live="polite" className="text-sm text-gray-600">{progress}</p>}
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
