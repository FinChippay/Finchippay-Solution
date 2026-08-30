import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useCallback, useEffect } from "react";
import ContactImportModal from "@/components/ContactImportModal";
import WalletConnect from "@/components/WalletConnect";
import { useContacts } from "@/hooks/useContacts";
import {
  resolveFederationWithCache,
  getCachedFederationAddress,
  addressBookNeedsReEncryption,
} from "@/lib/addressBook";
import {
  exportContactsCSV,
  exportContactsVCard,
  downloadFile,
} from "@/lib/contactImportExport";
import type { Contact } from "@/lib/contactsDB";
import {
  isValidStellarAddress,
  resolveFederationAddress,
} from "@/lib/stellar";
import { useToast } from "@/lib/useToast";
import { useWallet } from "@/lib/useWallet";
import { reEncryptLocalData } from "@/lib/wallet";
import { copyToClipboard } from "@/utils/format";

function FederationBadge({ address }: { address?: string }) {
  if (!address) return null;
  const domain = address.split("*")[1] || "";
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
      {domain}
    </span>
  );
}

function GroupBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40`, borderWidth: 1 }}
    >
      {name}
    </span>
  );
}

function LockIcon({ className, "aria-label": ariaLabel }: { className?: string; "aria-label"?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a2.25 2.25 0 012.25 2.25v6.75a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25v-6.75a2.25 2.25 0 012.25-2.25z" />
    </svg>
  );
}

export default function Contacts() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const { showToast } = useToast();
  const { contacts, add: addContact, update: updateContact, remove: removeContact, groups, addToGroup, createGroup, deleteGroup } = useContacts();

  const [showImportModal, setShowImportModal] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [federationInput, setFederationInput] = useState("");
  const [federationLoading, setFederationLoading] = useState(false);
  const [federationResult, setFederationResult] = useState<{ address: string; federationAddress: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#6366f1");
  const [dragContact, setDragContact] = useState<number | null>(null);
  const [needsReEncryption, setNeedsReEncryption] = useState(false);
  const [reEncrypting, setReEncrypting] = useState(false);

  useEffect(() => {
    setNeedsReEncryption(publicKey ? addressBookNeedsReEncryption(publicKey) : false);
  }, [publicKey, contacts]);

  // Re-encrypt the in-memory contacts under the active wallet's key.
  const handleReEncrypt = async () => {
    setReEncrypting(true);
    try {
      await reEncryptLocalData();
      setNeedsReEncryption(publicKey ? addressBookNeedsReEncryption(publicKey) : false);
      showToast("Contacts re-encrypted for this wallet");
    } catch {
      showToast("Failed to re-encrypt contacts");
    } finally {
      setReEncrypting(false);
    }
  };

  // Resolve federation address when adding a contact that looks like a federation address
  const tryResolveFederation = useCallback(async (addr: string) => {
    if (!addr.includes("*")) return;
    const cached = getCachedFederationAddress(addr);
    if (cached) {
      setAddress(cached);
      showToast("Federation address resolved from cache");
      return;
    }
    const resolved = await resolveFederationWithCache(addr);
    if (resolved) {
      setAddress(resolved);
      showToast("Federation address resolved");
    }
  }, [showToast]);

  const handleSaveContact = async () => {
    if (!name.trim() || !address.trim()) {
      showToast("Please enter both name and address");
      return;
    }
    if (!isValidStellarAddress(address)) {
      showToast("Invalid Stellar address");
      return;
    }
    try {
      if (editingId !== null) {
        await updateContact(editingId, { name: name.trim(), publicKey: address.trim() });
        showToast("Contact updated");
        setEditingId(null);
      } else {
        await addContact({ name: name.trim(), publicKey: address.trim() });
        showToast("Contact saved");
      }
      setName("");
      setAddress("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save contact");
    }
  };

  const handleDeleteContact = async (id: number) => {
    await removeContact(id);
    showToast("Contact deleted");
  };

  const handleEditContact = (contact: Contact) => {
    setEditingId(contact.id ?? null);
    setName(contact.name);
    setAddress(contact.publicKey);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setName("");
    setAddress("");
  };

  const handleFederationLookup = async () => {
    if (!federationInput.trim()) {
      showToast("Enter a federation address (user*domain.com)");
      return;
    }
    setFederationLoading(true);
    try {
      const resolvedAddress = await resolveFederationAddress(federationInput.trim());
      setFederationResult({ address: resolvedAddress, federationAddress: federationInput.trim() });
      showToast("Federation lookup successful");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Federation lookup failed");
      setFederationResult(null);
    } finally {
      setFederationLoading(false);
    }
  };

  const handleUseResolvedAddress = () => {
    if (!federationResult) return;
    setAddress(federationResult.address);
    setFederationInput("");
    setFederationResult(null);
    showToast("Address copied to form");
  };

  const handleSendXLM = (contact: Contact) => {
    router.push({ pathname: "/dashboard", query: { prefillDestination: contact.publicKey } });
  };

  const handleCopyAddress = (addr: string) => {
    copyToClipboard(addr);
    showToast("Address copied");
  };

  // Drag & drop group assignment
  const handleDragStart = (contactId: number) => {
    setDragContact(contactId);
  };

  const handleDropOnGroup = async (groupId: number) => {
    if (dragContact === null) return;
    const contact = contacts.find((c) => c.id === dragContact);
    if (!contact) return;
    if (contact.groupIds?.includes(groupId)) {
      showToast("Contact already in this group");
      setDragContact(null);
      return;
    }
    await addToGroup(dragContact, groupId);
    showToast("Contact added to group");
    setDragContact(null);
  };

  // Group management
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      showToast("Enter a group name");
      return;
    }
    await createGroup({ name: newGroupName.trim(), color: newGroupColor, icon: "users" });
    setNewGroupName("");
    setNewGroupColor("#6366f1");
    setShowCreateGroup(false);
    showToast("Group created");
  };

  const handleDeleteGroup = async (id: number) => {
    await deleteGroup(id);
    if (selectedGroupId === id) setSelectedGroupId(null);
    showToast("Group deleted");
  };

  // Filtering and search
  const filteredContacts = contacts.filter((c) => {
    if (selectedGroupId !== null && !(c.groupIds || []).includes(selectedGroupId)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.publicKey.toLowerCase().includes(q) ||
        (c.federationAddress || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Get group names for a contact
  const getGroupNames = (contact: Contact) => {
    return (contact.groupIds || [])
      .map((gid) => groups.find((g) => g.id === gid))
      .filter(Boolean);
  };

  const handleImportContacts = async (imported: Array<{ name: string; address: string; federation?: string }>, overwriteDuplicates: boolean) => {
    const existingByAddress = new Map(contacts.map((c) => [c.publicKey, c]));
    let added = 0;
    let updated = 0;
    for (const row of imported) {
      const existing = existingByAddress.get(row.address);
      if (existing) {
        if (overwriteDuplicates && existing.id !== undefined) {
          await updateContact(existing.id, {
            name: row.name,
            ...(row.federation ? { federationAddress: row.federation } : {}),
          });
          updated++;
        }
      } else {
        await addContact({
          name: row.name,
          publicKey: row.address,
          ...(row.federation ? { federationAddress: row.federation } : {}),
        });
        added++;
      }
    }
    setShowImportModal(false);
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} added`);
    if (updated > 0) parts.push(`${updated} updated`);
    showToast(parts.length > 0 ? `Contacts imported: ${parts.join(", ")}` : "No new contacts imported");
  };

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <Head>
          <title>Contacts | Finchippay-Solution</title>
          <meta name="description" content="Manage your Stellar address book and federation contacts on Finchippay." />
        </Head>
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-3">Contacts</h1>
          <p className="text-slate-600 dark:text-slate-400">Connect your wallet to manage contacts</p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      <Head>
        <title>Contacts | Finchippay-Solution</title>
        <meta name="description" content="Manage your Stellar address book and federation contacts on Finchippay." />
      </Head>

      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white mb-1">Contacts</h1>
        <p className="text-slate-600 dark:text-slate-400">Save and manage Stellar addresses</p>

        {/* Encryption notice */}
        <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-sm text-amber-800 dark:text-amber-200">Your contacts are stored locally in this browser and persist across sessions. Avoid using this feature on shared or public computers.</p>
          </div>
        </div>

        {/* Re-encryption prompt shown after switching wallets */}
        {needsReEncryption && (
          <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Your stored contacts were encrypted for a different wallet. Re-encrypt them for the wallet you have connected now.
                </p>
                <button
                  onClick={handleReEncrypt}
                  disabled={reEncrypting}
                  className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-amber-900 dark:text-amber-100 bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                >
                  <LockIcon className="w-4 h-4" />
                  {reEncrypting ? "Re-encrypting…" : "Re-encrypt for this wallet"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-stellar-700 dark:text-stellar-300 bg-stellar-50 dark:bg-stellar-500/10 border border-stellar-500/20 hover:bg-stellar-500/20 hover:border-stellar-500/30 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Import
          </button>
          <button onClick={() => {
            if (contacts.length === 0) { showToast("No contacts to export"); return; }
            const csv = exportContactsCSV(contacts.map((c) => ({ name: c.name, address: c.publicKey, federation: c.federationAddress })));
            downloadFile(csv, "finchippay-contacts.csv", "text/csv");
            showToast(`Exported ${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`);
          }} disabled={contacts.length === 0} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            Export CSV
          </button>
          <button onClick={() => {
            if (contacts.length === 0) { showToast("No contacts to export"); return; }
            const vcf = exportContactsVCard(contacts.map((c) => ({ name: c.name, address: c.publicKey, federation: c.federationAddress })));
            downloadFile(vcf, "finchippay-contacts.vcf", "text/vcard");
            showToast(`Exported ${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`);
          }} disabled={contacts.length === 0} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
            Export vCard
          </button>
          <button onClick={() => setShowCreateGroup(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New Group
          </button>
        </div>
      </div>

      {showImportModal && (
        <ContactImportModal
          existingContacts={contacts.map((c) => ({ id: String(c.id), nickname: c.name, address: c.publicKey }))}
          onImport={handleImportContacts}
          onClose={() => setShowImportModal(false)}
        />
      )}

      <div className="flex gap-6">
        {/* Groups sidebar */}
        <div className="w-56 shrink-0">
          <div className="card p-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Groups</h3>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedGroupId(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedGroupId === null ? "bg-stellar-500/20 text-stellar-300" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                  All Contacts
                </span>
              </button>
              {groups.map((g) => {
                const count = contacts.filter((c) => (c.groupIds || []).includes(g.id!)).length;
                return (
                  <div key={g.id} className="group flex items-center">
                    <button
                      onClick={() => setSelectedGroupId(g.id!)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDropOnGroup(g.id!)}
                      className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedGroupId === g.id ? "bg-stellar-500/20 text-stellar-300" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                        {g.name}
                        <span className="ml-auto text-xs text-slate-500">{count}</span>
                      </span>
                    </button>
                    {g.name !== "Favorites" && g.name !== "Frequent" && g.name !== "All" && (
                      <button
                        onClick={() => handleDeleteGroup(g.id!)}
                        className="p-1 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
                        title="Delete group"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Create group form */}
          {showCreateGroup && (
            <div className="card p-3 mt-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">New Group</h3>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
                className="w-full px-2 py-1.5 rounded text-sm bg-white/5 border border-white/10 text-white placeholder:text-slate-500 mb-2"
                onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
              />
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs text-slate-400">Color:</label>
                <input
                  type="color"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreateGroup} className="flex-1 px-2 py-1.5 rounded text-xs font-medium bg-stellar-500/20 text-stellar-300 border border-stellar-500/30 hover:bg-stellar-500/30 transition-colors">Create</button>
                <button onClick={() => setShowCreateGroup(false)} className="flex-1 px-2 py-1.5 rounded text-xs font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-colors">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-8">
          {/* Search */}
          <div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts, groups, or federation addresses..."
              className="input-field w-full"
            />
          </div>

          {/* Add/Edit Contact Form */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-stellar-700 dark:text-stellar-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              {editingId ? "Edit Contact" : "Add Contact"}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label">Contact name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Alice, Daily Coffee" className="input-field" />
              </div>
              <div>
                <label className="label">Stellar address</label>
                <div className="relative">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      if (e.target.value.includes("*")) tryResolveFederation(e.target.value);
                    }}
                    placeholder="G... (56 character public key)"
                    className="input-field"
                  />
                  {address.includes("*") && (
                    <button
                      onClick={() => tryResolveFederation(address)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-xs font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
                    >
                      Resolve
                    </button>
                  )}
                </div>
                {address.length > 0 && !isValidStellarAddress(address) && !address.includes("*") && (
                  <p className="mt-1 text-xs text-red-400">Invalid Stellar address</p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={handleSaveContact} disabled={!name.trim() || !address.trim()} className="btn-primary flex-1">
                  {editingId ? "Update Contact" : "Save Contact"}
                </button>
                {editingId && (
                  <button onClick={handleCancelEdit} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">Cancel</button>
                )}
              </div>
            </div>
          </div>

          {/* Federation Lookup */}
          <div className="card">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-stellar-700 dark:text-stellar-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.5 5.5a7.5 7.5 0 0010.5 10.5z" /></svg>
              Federation Lookup
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label">Federation address</label>
                <input
                  type="text"
                  value={federationInput}
                  onChange={(e) => setFederationInput(e.target.value)}
                  placeholder="user*domain.com"
                  className="input-field"
                  onKeyDown={(e) => { if (e.key === "Enter") handleFederationLookup(); }}
                />
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Resolve Stellar Federation addresses to public keys</p>
              </div>
              {federationResult && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">Resolved address:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-slate-950/50 p-2 rounded font-mono text-slate-200 break-all">{federationResult.address}</code>
                    <button onClick={handleUseResolvedAddress} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Use
                    </button>
                  </div>
                </div>
              )}
              <button onClick={handleFederationLookup} disabled={federationLoading || !federationInput.trim()} className="btn-primary w-full">
                {federationLoading ? (
                  <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Looking up...</>
                ) : (
                  <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.5 5.5a7.5 7.5 0 0010.5 10.5z" /></svg> Resolve Address</>
                )}
              </button>
            </div>
          </div>

          {/* Contacts List */}
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-stellar-700 dark:text-stellar-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              {selectedGroupId ? groups.find((g) => g.id === selectedGroupId)?.name || "Contacts" : "All Contacts"}
              <LockIcon
                className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                aria-label="Contacts are encrypted at rest"
              />
              <span className="ml-auto text-sm font-normal text-slate-600 dark:text-slate-400">{filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""}</span>
            </h2>

            {filteredContacts.length === 0 ? (
              <div className="card text-center py-12">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-500 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                <p className="text-slate-600 dark:text-slate-400">{contacts.length === 0 ? "No contacts yet. Add one to get started." : "No contacts match your search."}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredContacts.map((contact) => (
                  <div
                    key={contact.id}
                    draggable
                    onDragStart={() => contact.id !== undefined && handleDragStart(contact.id)}
                    className="card-hover p-4 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/30 transition-all cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-slate-900 dark:text-white">{contact.name}</h3>
                          <FederationBadge address={contact.federationAddress} />
                          {getGroupNames(contact).map((g) => g && (
                            <GroupBadge key={g.id} name={g.name} color={g.color} />
                          ))}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-mono mt-1 break-all">{contact.publicKey}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleCopyAddress(contact.publicKey)} title="Copy address" className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/50 transition-colors">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={() => handleSendXLM(contact)} title="Send XLM to this contact" className="px-3 py-2 rounded-lg text-sm font-medium text-stellar-700 dark:text-stellar-300 bg-stellar-50 dark:bg-stellar-500/10 border border-stellar-500/20 hover:bg-stellar-500/20 hover:border-stellar-500/30 transition-colors">Send</button>
                        <button onClick={() => handleEditContact(contact)} title="Edit contact" className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/50 transition-colors">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => contact.id !== undefined && handleDeleteContact(contact.id)} title="Delete contact" className="p-2 rounded-lg text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-stellar-700 hover:text-stellar-600 dark:text-stellar-400 dark:hover:text-stellar-300 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
