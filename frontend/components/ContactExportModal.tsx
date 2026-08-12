"use client";
import { useState } from "react";
import { useContacts } from "@/hooks/useContacts";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { downloadFile } from "@/lib/contactImportExport";
import { generateCSV, generateVCard } from "@/lib/contactsDB";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactExportModal({ isOpen, onClose }: Props) {
  const { contacts, groups } = useContacts();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [includeGroups, setIncludeGroups] = useState(true);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: onClose });

  if (!isOpen) return null;

  const toggleAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id!)));
    }
  };

  const toggle = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleExportCSV = () => {
    const toExport = contacts.filter((c) => selectedIds.has(c.id!));
    if (toExport.length === 0) return;
    const csv = includeGroups ? generateCSV(toExport, groups) : generateCSV(toExport);
    downloadFile(csv, "finchippay-contacts.csv", "text/csv");
    onClose();
  };

  const handleExportVCard = () => {
    const toExport = contacts.filter((c) => selectedIds.has(c.id!));
    if (toExport.length === 0) return;
    const vcf = includeGroups ? generateVCard(toExport, groups) : generateVCard(toExport);
    downloadFile(vcf, "finchippay-contacts.vcf", "text/vcard");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-contacts-title"
        className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-white/10 focus:outline-none"
      >
        <h3 id="export-contacts-title" className="text-lg font-bold text-white mb-4">Export Contacts</h3>

        <div className="mb-4">
          <label className="flex items-center gap-2 mb-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={includeGroups}
              onChange={(e) => setIncludeGroups(e.target.checked)}
              className="rounded border-white/20"
            />
            Include group information in export
          </label>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-slate-400">{selectedIds.size} of {contacts.length} selected</span>
          <button onClick={toggleAll} className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors">
            {selectedIds.size === contacts.length ? "Deselect all" : "Select all"}
          </button>
        </div>

        <div className="max-h-48 overflow-y-auto mb-4 space-y-1">
          {contacts.map((c) => {
            const groupNames = (c.groupIds || [])
              .map((gid) => groups.find((g) => g.id === gid)?.name)
              .filter(Boolean)
              .join(", ");
            return (
              <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id!)}
                  onChange={() => toggle(c.id!)}
                  className="rounded border-white/20"
                />
                <span className="text-sm text-white flex-1 truncate">{c.name}</span>
                {includeGroups && groupNames && (
                  <span className="text-[10px] text-slate-500 truncate max-w-[100px]">{groupNames}</span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleExportCSV}
            disabled={selectedIds.size === 0}
            className="btn-primary flex-1"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportVCard}
            disabled={selectedIds.size === 0}
            className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-white hover:bg-white/5 transition-colors"
          >
            Export vCard
          </button>
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:bg-white/5 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
