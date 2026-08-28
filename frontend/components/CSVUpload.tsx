import Papa from "papaparse";
import { useCallback, useRef, useState } from "react";
import { isValidStellarAddress } from "@/lib/stellar";

type ColumnMapping = {
  recipient: number | null;
  amount: number | null;
  asset: number | null;
  memo: number | null;
};

type ParsedRow = {
  id: string;
  data: Record<string, string>;
  recipient?: string;
  amount?: string;
  asset?: string;
  memo?: string;
  errors: string[];
  isValid: boolean;
};

type CSVUploadStep = "upload" | "mapping" | "preview";

interface CSVUploadProps {
  onImport: (rows: ParsedRow[]) => void;
  onCancel: () => void;
}

function validateRow(row: ParsedRow, mapping: ColumnMapping): ParsedRow {
  const errors: string[] = [];

  if (mapping.recipient !== null) {
    row.recipient = row.data[mapping.recipient] || "";
    if (!row.recipient || !isValidStellarAddress(row.recipient)) {
      errors.push("Invalid Stellar address");
    }
  } else {
    errors.push("Recipient not mapped");
  }

  if (mapping.amount !== null) {
    row.amount = row.data[mapping.amount] || "";
    const amount = parseFloat(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push("Invalid amount (must be > 0)");
    }
  } else {
    errors.push("Amount not mapped");
  }

  if (mapping.asset !== null) {
    row.asset = row.data[mapping.asset] || "XLM";
  } else {
    row.asset = "XLM";
  }

  if (mapping.memo !== null) {
    row.memo = row.data[mapping.memo] || "";
  }

  row.errors = errors;
  row.isValid = errors.length === 0;
  return row;
}

function downloadTemplate() {
  const headers = "recipient,amount,asset,memo\n";
  const exampleRows = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX,100,XLM,Payment for services\n';
  const csv = headers + exampleRows;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "batch-payments-template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export default function CSVUpload({ onImport, onCancel }: CSVUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<CSVUploadStep>("upload");
  const [csvData, setCSVData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    recipient: null,
    amount: null,
    asset: null,
    memo: null,
  });
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      setUploadError("Please select a CSV file");
      return;
    }

    // Show progress for large files
    const fileSize = file.size;
    setTotalBytes(fileSize);
    setUploadedBytes(0);
    setUploadProgress(0);

    // Simulate progress for large files (PapaParse doesn't have progress for local files)
    if (fileSize > 500 * 1024) {
      const progressInterval = setInterval(() => {
        setUploadedBytes((prev) => {
          const next = Math.min(prev + 50 * 1024, fileSize);
          setUploadProgress((next / fileSize) * 100);
          if (next >= fileSize) {
            clearInterval(progressInterval);
          }
          return next;
        });
      }, 100);
    }

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        setUploadProgress(100);
        setUploadedBytes(fileSize);

        if (!results.data || results.data.length === 0) {
          setUploadError("CSV file is empty");
          setUploadProgress(null);
          return;
        }

        const data = results.data as string[][];
        if (data.length < 2) {
          setUploadError("CSV must have headers and at least one data row");
          setUploadProgress(null);
          return;
        }

        setHeaders(data[0]);
        setCSVData(data.slice(1));
        setUploadError(null);
        setUploadProgress(null);
        setStep("mapping");
      },
      error: (error) => {
        setUploadProgress(null);
        setUploadError(`CSV parsing error: ${error.message}`);
      },
    });
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFileSelect(files[0]);
    }
  };

  const handleMappingChange = (field: keyof ColumnMapping, columnIndex: number | null) => {
    setMapping((prev) => ({
      ...prev,
      [field]: columnIndex,
    }));
  };

  const handleProceedToPreview = () => {
    if (mapping.recipient === null || mapping.amount === null) {
      setUploadError("Please map recipient and amount columns");
      return;
    }

    const rows: ParsedRow[] = csvData.map((rowData, idx) => {
      const row: ParsedRow = {
        id: `row-${idx}`,
        data: headers.reduce((acc, header, i) => {
          acc[i] = rowData[i] || "";
          return acc;
        }, {} as Record<string, string>),
        errors: [],
        isValid: true,
      };
      return validateRow(row, mapping);
    });

    setParsedRows(rows);
    setStep("preview");
  };

  const handleRowChange = (rowId: string, field: "recipient" | "amount" | "memo", value: string) => {
    setParsedRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? validateRow(
              {
                ...row,
                [field]: value,
                data: { ...row.data },
              },
              mapping
            )
          : row
      )
    );
  };

  const handleImportValid = () => {
    const validRows = parsedRows.filter((row) => row.isValid);
    if (validRows.length === 0) {
      setUploadError("No valid rows to import");
      return;
    }
    onImport(validRows);
  };

  if (step === "upload") {
    return (
      <div className="space-y-4">
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragActive
              ? "border-stellar-500 bg-stellar-500/5"
              : "border-slate-300 dark:border-slate-600"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            className="hidden"
          />
          <div className="space-y-3">
            <div className="text-4xl">📄</div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">
                Drag and drop your CSV file here
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                or{" "}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-stellar-500 hover:underline"
                >
                  browse
                </button>
              </p>
            </div>
          </div>

          {/* Upload progress indicator */}
          {uploadProgress !== null && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  {uploadedBytes < totalBytes
                    ? "Uploading..."
                    : "Processing..."}
                </span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-stellar-500 transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              {totalBytes > 0 && (
                <p className="text-xs text-slate-500">
                  {(totalBytes / 1024).toFixed(1)} KB —{" "}
                  {uploadProgress < 100
                    ? `${(uploadedBytes / 1024).toFixed(1)} KB uploaded`
                    : "Parsing rows..."}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => downloadTemplate()}
            className="btn-secondary flex-1 py-2"
          >
            📥 Download template
          </button>
          <button
            onClick={onCancel}
            className="btn-outline flex-1 py-2"
          >
            Cancel
          </button>
        </div>

        {uploadError && (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-100">
            {uploadError}
          </div>
        )}
      </div>
    );
  }

  if (step === "mapping") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white mb-3">
            Map CSV columns to payment fields
          </h3>
          <div className="space-y-3">
            {(["recipient", "amount", "asset", "memo"] as const).map((field) => (
              <div key={field}>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 capitalize mb-1">
                  {field === "recipient" ? "Recipient Address" : field === "amount" ? "Amount" : field === "asset" ? "Asset (Optional)" : "Memo (Optional)"}
                </label>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) =>
                    handleMappingChange(
                      field,
                      e.target.value ? parseInt(e.target.value) : null
                    )
                  }
                  className="input-field w-full"
                >
                  <option value="">Not mapped</option>
                  {headers.map((header, idx) => (
                    <option key={idx} value={idx}>
                      {header} (Column {idx + 1})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleProceedToPreview}
            className="btn-primary flex-1 py-2"
          >
            Continue to preview
          </button>
          <button
            onClick={() => {
              setStep("upload");
              setUploadError(null);
            }}
            className="btn-outline flex-1 py-2"
          >
            Back
          </button>
        </div>

        {uploadError && (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-100">
            {uploadError}
          </div>
        )}
      </div>
    );
  }

  // Preview step
  const validCount = parsedRows.filter((r) => r.isValid).length;
  const invalidCount = parsedRows.length - validCount;

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      <div className="sticky top-0 bg-white dark:bg-slate-900 pb-3">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
          Preview ({validCount} valid, {invalidCount} invalid)
        </h3>
        <div className="flex gap-2 text-xs">
          {validCount > 0 && (
            <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              ✓ {validCount} valid
            </span>
          )}
          {invalidCount > 0 && (
            <span className="px-2 py-1 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
              ✗ {invalidCount} invalid
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {parsedRows.map((row) => (
          <div
            key={row.id}
            className={`rounded-2xl border p-3 ${
              row.isValid
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-rose-500/20 bg-rose-500/5"
            }`}
          >
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-3">
                <label>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Recipient</span>
                  <input
                    type="text"
                    value={row.recipient || ""}
                    onChange={(e) => handleRowChange(row.id, "recipient", e.target.value)}
                    className="input-field w-full text-sm mt-1"
                  />
                </label>
                <label>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Amount</span>
                  <input
                    type="number"
                    step="0.0000001"
                    value={row.amount || ""}
                    onChange={(e) => handleRowChange(row.id, "amount", e.target.value)}
                    className="input-field w-full text-sm mt-1"
                  />
                </label>
                <label>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Asset</span>
                  <input
                    type="text"
                    value={row.asset || "XLM"}
                    readOnly
                    className="input-field w-full text-sm mt-1 opacity-50"
                  />
                </label>
              </div>

              <label>
                <span className="text-xs text-slate-600 dark:text-slate-400">Memo</span>
                <input
                  type="text"
                  value={row.memo || ""}
                  onChange={(e) => handleRowChange(row.id, "memo", e.target.value)}
                  maxLength={28}
                  className="input-field w-full text-sm mt-1"
                />
              </label>

              {row.errors.length > 0 && (
                <div className="text-xs text-rose-600 dark:text-rose-400">
                  {row.errors.join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 bg-white dark:bg-slate-900 pt-3 flex gap-2">
        <button
          onClick={handleImportValid}
          disabled={validCount === 0}
          className="btn-primary flex-1 py-2 text-sm"
        >
          Import {validCount} valid rows
        </button>
        <button
          onClick={() => {
            setStep("mapping");
            setUploadError(null);
          }}
          className="btn-outline flex-1 py-2 text-sm"
        >
          Back
        </button>
      </div>
    </div>
  );
}
