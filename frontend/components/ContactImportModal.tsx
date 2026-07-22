/**
 * @file components/ContactImportModal.tsx
 * @description Modal for importing contacts from a CSV file.
 *
 * Features:
 * - Drag-and-drop or click-to-browse file upload
 * - Per-row validation with inline error highlighting
 * - Skip-duplicates / overwrite-duplicates option
 * - Preview of parsed rows before committing to the address book
 */

import { useState, useCallback, useRef, DragEvent, ChangeEvent } from "react";
import {
  parseContactsCSVAnnotated,
  readFileAsText,
  type AnnotatedRow,
} from "@/lib/contactImportExport";
import type { AddressBookContact } from "@/lib/addressBook";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContactImportModalProps {
  /** Currently saved contacts — used for duplicate detection. */
  existingContacts: AddressBookContact[];
  /** Called when the user confirms the import with the list of valid rows. */
  onImport: (
    contacts: Array<{ name: string; address: string; federation?: string }>,
    overwriteDuplicates: boolean
  ) => void;
  /** Called when the modal should be closed without importing. */
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContactImportModal({
  existingContacts,
  onImport,
  onClose,
}: ContactImportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<AnnotatedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build a set of existing addresses for duplicate detection
  const existingAddresses = new Set(existingContacts.map((c) => c.address));

  // ── File parsing ──────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Only .csv files are supported. Please select a CSV file.");
      setRows([]);
      setFileName(null);
      return;
    }

    try {
      const text = await readFileAsText(file);
      const annotated = parseContactsCSVAnnotated(text);
      if (annotated.length === 0) {
        setParseError(
          'The file has no data rows or is missing the required "Name" and "Stellar Address" columns.'
        );
        setRows([]);
      } else {
        setParseError(null);
        setRows(annotated);
      }
      setFileName(file.name);
    } catch {
      setParseError("Could not read the file. Please try again.");
      setRows([]);
      setFileName(null);
    }
  }, []);

  // ── Drag-and-drop handlers ────────────────────────────────────────────────

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset so the same file can be re-selected after clearing
    e.target.value = "";
  };

  // ── Import confirmation ───────────────────────────────────────────────────

  const validRows = rows.filter((r) => r.contact && !r.error);
  const duplicateRows = validRows.filter((r) =>
    existingAddresses.has(r.contact!.address)
  );
  const newRows = validRows.filter(
    (r) => !existingAddresses.has(r.contact!.address)
  );

  const importableCount = overwrite ? validRows.length : newRows.length;

  const handleConfirmImport = () => {
    const toImport = (overwrite ? validRows : newRows).map((r) => r.contact!);
    onImport(toImport, overwrite);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      {/* Panel */}
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <h2
            id="import-modal-title"
            className="font-display text-lg font-semibold text-white flex items-center gap-2"
          >
            <UploadIcon className="w-5 h-5 text-stellar-400" />
            Import Contacts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close import modal"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload CSV file"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            className={`
              flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed
              cursor-pointer transition-colors select-none
              ${isDragging
                ? "border-stellar-400 bg-stellar-500/10"
                : "border-slate-600 hover:border-slate-500 bg-slate-800/30"
              }
            `}
          >
            <UploadIcon className="w-10 h-10 text-slate-500" />
            {fileName ? (
              <p className="text-sm text-white font-medium">{fileName}</p>
            ) : (
              <>
                <p className="text-sm text-slate-300 font-medium">
                  Drag &amp; drop a CSV file here, or click to browse
                </p>
                <p className="text-xs text-slate-500">
                  Format: Name, Stellar Address, Federation Username (optional)
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileInput}
            className="sr-only"
            aria-hidden="true"
          />

          {/* Parse error */}
          {parseError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">
              {parseError}
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && (
            <div className="space-y-4">
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className="px-2.5 py-1 rounded-full bg-slate-700 text-slate-200">
                  {rows.length} row{rows.length !== 1 ? "s" : ""} parsed
                </span>
                {validRows.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300">
                    {validRows.length} valid
                  </span>
                )}
                {rows.filter((r) => r.error).length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-red-500/20 text-red-300">
                    {rows.filter((r) => r.error).length} error
                    {rows.filter((r) => r.error).length !== 1 ? "s" : ""}
                  </span>
                )}
                {duplicateRows.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300">
                    {duplicateRows.length} duplicate
                    {duplicateRows.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-left text-xs text-slate-400 uppercase tracking-wide">
                      <th className="px-3 py-2.5 font-medium">#</th>
                      <th className="px-3 py-2.5 font-medium">Name</th>
                      <th className="px-3 py-2.5 font-medium">Stellar Address</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {rows.map((row) => {
                      const isDuplicate =
                        !row.error &&
                        row.contact &&
                        existingAddresses.has(row.contact.address);

                      return (
                        <tr
                          key={row.rowNumber}
                          className={`
                            transition-colors
                            ${row.error
                              ? "bg-red-500/5 text-red-300"
                              : isDuplicate
                              ? "bg-amber-500/5 text-amber-200"
                              : "text-slate-200"}
                          `}
                        >
                          <td className="px-3 py-2 text-xs text-slate-500 tabular-nums">
                            {row.rowNumber}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {row.contact?.name ?? <span className="italic text-slate-500">—</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs break-all">
                            {row.contact?.address ?? <span className="italic text-slate-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {row.error ? (
                              <span className="flex items-center gap-1 text-red-400">
                                <ErrorIcon className="w-3.5 h-3.5 shrink-0" />
                                {row.error}
                              </span>
                            ) : isDuplicate ? (
                              <span className="flex items-center gap-1 text-amber-400">
                                <WarningIcon className="w-3.5 h-3.5 shrink-0" />
                                Duplicate
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-emerald-400">
                                <CheckIcon className="w-3.5 h-3.5 shrink-0" />
                                OK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Duplicate handling */}
              {duplicateRows.length > 0 && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <WarningIcon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-200 font-medium mb-2">
                      {duplicateRows.length} duplicate address
                      {duplicateRows.length !== 1 ? "es" : ""} found
                    </p>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={overwrite}
                        onChange={(e) => setOverwrite(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-stellar-500 focus:ring-stellar-500"
                        aria-label="Overwrite duplicate contacts"
                      />
                      <span className="text-sm text-amber-200">
                        Overwrite existing contacts with duplicate addresses
                      </span>
                    </label>
                    {!overwrite && (
                      <p className="mt-1.5 text-xs text-slate-400">
                        {duplicateRows.length} duplicate
                        {duplicateRows.length !== 1 ? "s" : ""} will be skipped.
                        Only {newRows.length} new contact
                        {newRows.length !== 1 ? "s" : ""} will be imported.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700 shrink-0 bg-slate-900">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmImport}
            disabled={importableCount === 0}
            className="px-4 py-2.5 rounded-lg text-sm font-medium btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import {importableCount > 0 ? `${importableCount} ` : ""}
            contact{importableCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  );
}
