const DB_NAME = "finchippay-contacts";
const DB_VERSION = 2;
const CONTACTS_STORE = "contacts";
const GROUPS_STORE = "groups";

export interface ContactGroup {
  id?: number;
  name: string;
  color: string;
  icon: string;
  createdAt: number;
}

export interface Contact {
  id?: number;
  name: string;
  publicKey: string;
  federationAddress?: string;
  memo?: string;
  tags?: string[];
  groupIds?: number[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_GROUPS: Omit<ContactGroup, "id" | "createdAt">[] = [
  { name: "Favorites", color: "#f59e0b", icon: "star" },
  { name: "Frequent", color: "#6366f1", icon: "clock" },
  { name: "All", color: "#22d3ee", icon: "users" },
];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const oldStoreNames = new Set(request.transaction?.objectStoreNames || []);

      if (!db.objectStoreNames.contains(CONTACTS_STORE)) {
        const store = db.createObjectStore(CONTACTS_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("publicKey", "publicKey", { unique: true });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("federationAddress", "federationAddress", { unique: false });
      }

      if (!db.objectStoreNames.contains(GROUPS_STORE)) {
        const store = db.createObjectStore(GROUPS_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("name", "name", { unique: true });
      }

      // Seed default groups when the groups store is first created
      const groupsCreated = !oldStoreNames.has(GROUPS_STORE) && db.objectStoreNames.contains(GROUPS_STORE);
      if (groupsCreated) {
        const groupStore = request.transaction?.objectStore(GROUPS_STORE);
        if (groupStore) {
          for (const g of DEFAULT_GROUPS) {
            groupStore.add({ ...g, createdAt: Date.now() });
          }
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Contact operations ──────────────────────────────────────────────────

export async function addContact(contact: Omit<Contact, "id" | "createdAt" | "updatedAt">): Promise<number> {
  const db = await openDB();
  const now = Date.now();
  const record: Contact = { ...contact, createdAt: now, updatedAt: now };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, "readwrite");
    const store = tx.objectStore(CONTACTS_STORE);
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getAllContacts(): Promise<Contact[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, "readonly");
    const store = tx.objectStore(CONTACTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.name.localeCompare(b.name)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function updateContact(id: number, updates: Partial<Omit<Contact, "id" | "createdAt">>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, "readwrite");
    const store = tx.objectStore(CONTACTS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error("Contact not found")); return; }
      const updated = { ...existing, ...updates, updatedAt: Date.now() };
      store.put(updated);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => { db.close(); resolve(); };
  });
}

export async function deleteContact(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, "readwrite");
    const store = tx.objectStore(CONTACTS_STORE);
    store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllContacts(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, "readwrite");
    tx.objectStore(CONTACTS_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function searchContacts(query: string): Promise<Contact[]> {
  const all = await getAllContacts();
  const q = query.toLowerCase();
  return all.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.publicKey.toLowerCase().includes(q) ||
    (c.federationAddress && c.federationAddress.toLowerCase().includes(q))
  );
}

// ─── Group operations ────────────────────────────────────────────────────

export async function createGroup(group: Omit<ContactGroup, "id" | "createdAt">): Promise<number> {
  const db = await openDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUPS_STORE, "readwrite");
    const store = tx.objectStore(GROUPS_STORE);
    const request = store.add({ ...group, createdAt: now });
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getAllGroups(): Promise<ContactGroup[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUPS_STORE, "readonly");
    const store = tx.objectStore(GROUPS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.name.localeCompare(b.name)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deleteGroup(id: number): Promise<void> {
  const db = await openDB();
  const allContacts = await getAllContacts();
  // Remove group from all contacts
  for (const contact of allContacts) {
    if (contact.groupIds?.includes(id)) {
      await updateContact(contact.id!, {
        groupIds: contact.groupIds.filter((gId) => gId !== id),
      });
    }
  }
  // Delete the group
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUPS_STORE, "readwrite");
    const store = tx.objectStore(GROUPS_STORE);
    store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function addToGroup(contactId: number, groupId: number): Promise<void> {
  const contact = await getContactById(contactId);
  if (!contact) throw new Error("Contact not found");
  const groupIds = contact.groupIds || [];
  if (!groupIds.includes(groupId)) {
    await updateContact(contactId, { groupIds: [...groupIds, groupId] });
  }
}

export async function removeFromGroup(contactId: number, groupId: number): Promise<void> {
  const contact = await getContactById(contactId);
  if (!contact) throw new Error("Contact not found");
  const groupIds = (contact.groupIds || []).filter((id) => id !== groupId);
  await updateContact(contactId, { groupIds });
}

export async function getContactsByGroup(groupId: number): Promise<Contact[]> {
  const all = await getAllContacts();
  return all.filter((c) => c.groupIds?.includes(groupId));
}

async function getContactById(id: number): Promise<Contact | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, "readonly");
    const store = tx.objectStore(CONTACTS_STORE);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// ─── Import / Export (preserves group info) ──────────────────────────────

export async function importContacts(contacts: Omit<Contact, "id" | "createdAt" | "updatedAt">[]): Promise<number> {
  let count = 0;
  for (const contact of contacts) {
    try { await addContact(contact); count++; } catch {}
  }
  return count;
}

export function parseCSV(content: string): Omit<Contact, "id" | "createdAt" | "updatedAt">[] {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  const publicKeyIdx = headers.indexOf("publickey");
  const memoIdx = headers.indexOf("memo");
  const federationIdx = headers.indexOf("federationaddress");
  const groupsIdx = headers.indexOf("groups");
  if (nameIdx === -1 || publicKeyIdx === -1) return [];
  const contacts: Omit<Contact, "id" | "createdAt" | "updatedAt">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    contacts.push({
      name: cols[nameIdx],
      publicKey: cols[publicKeyIdx],
      memo: memoIdx >= 0 ? cols[memoIdx] : undefined,
      federationAddress: federationIdx >= 0 ? cols[federationIdx] : undefined,
      tags: groupsIdx >= 0 && cols[groupsIdx] ? cols[groupsIdx].split(";").map(g => g.trim()).filter(Boolean) : undefined,
    });
  }
  return contacts;
}

export function parseVCard(content: string): Omit<Contact, "id" | "createdAt" | "updatedAt">[] {
  const contacts: Omit<Contact, "id" | "createdAt" | "updatedAt">[] = [];
  const blocks = content.split(/(?=BEGIN:VCARD)/i);
  for (const block of blocks) {
    if (!block.toUpperCase().includes("BEGIN:VCARD")) continue;
    const fnMatch = block.match(/^FN[:;].*?:?([^\r\n]+)/im);
    const stellarMatch = block.match(/^X-STELLAR-ADDRESS[:;].*?:?([^\r\n]+)/im);
    const groupMatch = block.match(/^X-STELLAR-GROUPS[:;].*?:?([^\r\n]+)/im);
    const name = fnMatch ? fnMatch[1].trim() : "Imported Contact";
    const publicKey = stellarMatch ? stellarMatch[1].trim() : "";
    if (publicKey) {
      contacts.push({
        name,
        publicKey,
        tags: groupMatch ? groupMatch[1].trim().split(";").map(g => g.trim()).filter(Boolean) : undefined,
      });
    }
  }
  return contacts;
}

export function generateCSV(contacts: Contact[], groups?: ContactGroup[]): string {
  const groupMap = new Map<number, string>();
  if (groups) {
    for (const g of groups) {
      groupMap.set(g.id!, g.name);
    }
  }
  const header = "name,publicKey,memo,federationAddress,groups";
  const rows = contacts.map(c => {
    const groupNames = (c.groupIds || []).map((gId) => groupMap.get(gId) || "").filter(Boolean).join(";");
    return `${c.name},${c.publicKey},${c.memo || ""},${c.federationAddress || ""},"${groupNames}"`;
  });
  return [header, ...rows].join("\n");
}

export function generateVCard(contacts: Contact[], groups?: ContactGroup[]): string {
  const groupMap = new Map<number, string>();
  if (groups) {
    for (const g of groups) {
      groupMap.set(g.id!, g.name);
    }
  }
  return contacts.map(c => {
    const groupNames = (c.groupIds || []).map((gId) => groupMap.get(gId) || "").filter(Boolean).join(";");
    const groupLine = groupNames ? `X-STELLAR-GROUPS:${groupNames}\r\n` : "";
    return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\nX-STELLAR-ADDRESS:${c.publicKey}\r\n${groupLine}${c.memo ? `NOTE:${c.memo}\r\n` : ""}END:VCARD`;
  }).join("\r\n");
}
