"use client"; import { useState, useEffect, useCallback } from "react"; import { addContact as dbAdd, getAllContacts, updateContact as dbUpdate, deleteContact as dbDelete, clearAllContacts as dbClearAll, searchContacts as dbSearch, importContacts as dbImport, createGroup as dbCreateGroup, getAllGroups as dbGetAllGroups, deleteGroup as dbDeleteGroup, addToGroup as dbAddToGroup, removeFromGroup as dbRemoveFromGroup, getContactsByGroup as dbGetContactsByGroup, type Contact, type ContactGroup } from "@/lib/contactsDB";
 import { isValidStellarAddress } from "@/lib/stellar";
export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [all, allGroups] = await Promise.all([getAllContacts(), dbGetAllGroups()]);
      setContacts(all);
      setGroups(allGroups);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const add = useCallback(async (contact: Omit<Contact, "id" | "createdAt" | "updatedAt">) => {
    if (!isValidStellarAddress(contact.publicKey)) throw new Error("Invalid Stellar address");
    await dbAdd(contact);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: number, updates: Partial<Contact>) => {
    await dbUpdate(id, updates);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: number) => {
    await dbDelete(id);
    await refresh();
  }, [refresh]);

  const search = useCallback(async (query: string) => { return dbSearch(query); }, []);

  const clear = useCallback(async () => {
    await dbClearAll();
    await refresh();
  }, [refresh]);

  const importItems = useCallback(async (items: Omit<Contact, "id" | "createdAt" | "updatedAt">[]) => {
    const count = await dbImport(items);
    await refresh();
    return count;
  }, [refresh]);

  const createGroup = useCallback(async (group: Omit<ContactGroup, "id" | "createdAt">) => {
    await dbCreateGroup(group);
    await refresh();
  }, [refresh]);

  const deleteGroup = useCallback(async (id: number) => {
    await dbDeleteGroup(id);
    await refresh();
  }, [refresh]);

  const addToGroup = useCallback(async (contactId: number, groupId: number) => {
    await dbAddToGroup(contactId, groupId);
    await refresh();
  }, [refresh]);

  const removeFromGroup = useCallback(async (contactId: number, groupId: number) => {
    await dbRemoveFromGroup(contactId, groupId);
    await refresh();
  }, [refresh]);

  const getContactsByGroup = useCallback(async (groupId: number) => { return dbGetContactsByGroup(groupId); }, []);

  return {
    contacts, groups, loading,
    add, update, remove, search, import: importItems, clear, refresh,
    createGroup, deleteGroup, addToGroup, removeFromGroup, getContactsByGroup,
  };
}
