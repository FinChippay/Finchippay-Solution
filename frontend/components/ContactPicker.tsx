"use client"; import { useState } from "react"; import { useContacts } from "@/hooks/useContacts";

interface Props { isOpen: boolean; onClose: () => void; onSelect: (publicKey: string, name: string, memo?: string) => void; }

function FederationBadge({ address }: { address?: string }) {
  if (!address) return null;
  const domain = address.split("*")[1] || "";
  return <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{domain}</span>;
}

export default function ContactPicker({ isOpen, onClose, onSelect }: Props) {
  const { contacts, groups } = useContacts();
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);

  if (!isOpen) return null;

  let filtered = query
    ? contacts.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.publicKey.toLowerCase().includes(query.toLowerCase()) ||
        (c.federationAddress || "").toLowerCase().includes(query.toLowerCase())
      )
    : contacts;

  if (selectedGroup !== null) {
    filtered = filtered.filter(c => (c.groupIds || []).includes(selectedGroup));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-white/10">
        <h3 className="text-lg font-bold text-white mb-4">Select Contact</h3>

        {/* Group filter */}
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setSelectedGroup(null)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedGroup === null ? "bg-stellar-500/20 text-stellar-300 border border-stellar-500/30" : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"}`}
            >All</button>
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroup(g.id!)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedGroup === g.id ? "bg-stellar-500/20 text-stellar-300 border border-stellar-500/30" : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"}`}
                style={{ borderColor: selectedGroup === g.id ? g.color : undefined }}
              >{g.name}</button>
            ))}
          </div>
        )}

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search contacts or federation address..."
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm mb-4"
          autoFocus
        />
        <div className="max-h-60 overflow-y-auto">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => { onSelect(c.publicKey, c.name, c.memo); onClose(); }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm"
            >
              <span className="text-white">{c.name}</span>
              <FederationBadge address={c.federationAddress} />
              <span className="text-xs text-slate-400 ml-2">{c.publicKey.slice(0, 12)}...</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No contacts found</p>
          )}
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-xl border border-white/10 py-2 text-sm text-white">Cancel</button>
      </div>
    </div>
  );
}
