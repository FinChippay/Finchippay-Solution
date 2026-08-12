"use client";
import { useState, useCallback, useRef } from "react";
import { useContacts } from "@/hooks/useContacts";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  parseContactsCSVAnnotated,
  readFileAsText,
  type AnnotatedRow,
  type ContactRow,
} from "@/lib/contactImportExport";
import { parseVCard } from "@/lib/contactsDB";
import { isValidStellarAddress } from "@/lib/stellar";

interface Props {
  existingContacts: Array<{ id: string; nickname: string; address: string }>;
  onImport: (contacts: Array<{ name: string; address: string; federation?: string }>, overwriteDuplicates: boolean) => void;
  onClose: () => void;
}

export default function ContactImportModal({ existingContacts, onImport, onClose }: Props) {
  const { groups } = useContacts();
  const [rows, setRows] = useState<AnnotatedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [overwriteDuplicates, setOverwriteDuplicates] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: true, onEscape: onClose });

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setErrors([]);
    try {
      const text = await readFileAsText(file);
      if (file.name.endsWith(".vcf")) {
        const parsed = parseVCard(text);
        setRows(
          parsed.map((c, i) => ({
            rowNumber: i + 2,
            contact: { name: c.name, address: c.publicKey, federation: c.federationAddress },
            error: isValidStellarAddress(c.publicKey) ? "" : "Invalid Stellar address",
          }))
        );
      } else {
        const result = parseContactsCSVAnnotated(text);
        setRows(result);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Failed to read file"]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleBrowse = () => fileInputRef.current?.click();

  const handleConfirm = () => {
    if (selectedGroupId) {
      const gid = Number(selectedGroupId);
      const validContacts = rows
        .filter((r) => !r.error && r.contact)
        .map((r) => r.contact!);
      const groupContacts = groups.find((g) => g.id === gid);
      if (groupContacts) {
        for (const contact of existingContacts) {
          const existingGroupIds = (contact as any).groupIds || [];
          if (validContacts.find((vc) => vc.address === contact.address)) {
            (contact as any).groupIds = [...new Set([...existingGroupIds, gid])];
          }
        }
      }
    }
    onImport(
      rows.filter((r) => !r.error && r.contact).map((r) => r.contact!),
      overwriteDuplicates
    );
  };

  const validCount = rows.filter((r) => !r.error && r.contact).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-contacts-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 border border-white/10 max-h-[80vh] overflow-y-auto focus:outline-none"
      >
        <h3 id="import-contacts-title" className="text-lg font-bold text-white mb-4">Import Contacts</h3>

        {rows.length === 0 && !loading && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={handleBrowse}
            className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center cursor-pointer hover:border-stellar-500/50 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.vcf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <svg className="w-10 h-10 mx-auto mb-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <p className="text-sm text-slate-400">Drop a CSV or vCard file here, or click to browse</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <svg className="animate-spin w-8 h-8 mx-auto text-stellar-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-slate-400 mt-2">Parsing file...</p>
          </div>
        )}

        {rows.length > 0 && (
          <>
            {/* Group assignment */}
            {groups.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-white/5 border border-white/10">
                <label className="text-xs font-medium text-slate-400 block mb-1.5">Assign imported contacts to group (optional):</label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                >
                  <option value="">No group</option>
                  {groups.filter((g) => g.name !== "All").map((g) => (
                    <option key={g.id} value={g.id!}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-slate-300">
                {rows.length} rows
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300">
                {validCount} valid
              </span>
              {errorCount > 0 && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-300">
                  {errorCount} errors
                </span>
              )}
            </div>

            {/* Duplicate handling */}
            <label className="flex items-center gap-2 mb-4 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={overwriteDuplicates}
                onChange={(e) => setOverwriteDuplicates(e.target.checked)}
                className="rounded border-white/20"
              />
              Overwrite existing contacts with same address
            </label>

            {/* Preview table */}
            <div className="max-h-48 overflow-y-auto mb-4 border border-white/10 rounded-xl">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5">
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">#</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Address</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-white/5">
                      <td className="px-3 py-2 text-slate-500">{row.rowNumber}</td>
                      <td className="px-3 py-2 text-white">{row.contact?.name || "—"}</td>
                      <td className="px-3 py-2 text-slate-300 font-mono">{row.contact?.address || "—"}</td>
                      <td className="px-3 py-2">
                        {row.error ? (
                          <span className="text-rose-400" title={row.error}>Error</span>
                        ) : (
                          <span className="text-emerald-400">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {errors.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                {errors.map((err, i) => (
                  <p key={i} className="text-xs text-rose-300">{err}</p>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleConfirm}
            disabled={validCount === 0}
            className="btn-primary flex-1"
          >
            Import {validCount > 0 ? `${validCount} contact${validCount !== 1 ? "s" : ""}` : ""}
          </button>
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-white hover:bg-white/5 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
