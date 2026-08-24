/**
 * lib/transactionAnnotations.ts
 * Client-side transaction annotations (notes, tags, bookmarks).
 * Persisted to localStorage, keyed by transaction ID.
 */

export interface TransactionAnnotation {
  note: string;
  tags: string[];
  bookmarked: boolean;
}

const STORAGE_KEY = "finchippay:transaction-annotations";

function loadAnnotations(): Record<string, TransactionAnnotation> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, TransactionAnnotation>;
  } catch {
    return {};
  }
}

function saveAnnotations(data: Record<string, TransactionAnnotation>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save annotations:", e);
  }
}

/** Get the annotation for a specific transaction. */
export function getAnnotation(
  txId: string
): TransactionAnnotation | undefined {
  const all = loadAnnotations();
  return all[txId];
}

/** Get all bookmarked transaction IDs. */
export function getBookmarkedIds(): string[] {
  const all = loadAnnotations();
  return Object.entries(all)
    .filter(([, a]) => a.bookmarked)
    .map(([id]) => id);
}

/** Set or update the note for a transaction. */
export function setNote(txId: string, note: string): void {
  const all = loadAnnotations();
  all[txId] = { ...all[txId] ?? { note: "", tags: [], bookmarked: false }, note };
  saveAnnotations(all);
}

/** Toggle the bookmark flag for a transaction. Returns the new state. */
export function toggleBookmark(txId: string): boolean {
  const all = loadAnnotations();
  const current = all[txId] ?? { note: "", tags: [], bookmarked: false };
  current.bookmarked = !current.bookmarked;
  all[txId] = current;
  saveAnnotations(all);
  return current.bookmarked;
}

/** Add a tag to a transaction. */
export function addTag(txId: string, tag: string): void {
  const trimmed = tag.trim().toLowerCase();
  if (!trimmed) return;
  const all = loadAnnotations();
  const current = all[txId] ?? { note: "", tags: [], bookmarked: false };
  if (!current.tags.includes(trimmed)) {
    current.tags = [...current.tags, trimmed];
  }
  all[txId] = current;
  saveAnnotations(all);
}

/** Remove a tag from a transaction. */
export function removeTag(txId: string, tag: string): void {
  const all = loadAnnotations();
  const current = all[txId];
  if (!current) return;
  current.tags = current.tags.filter((t) => t !== tag);
  if (!current.note && current.tags.length === 0 && !current.bookmarked) {
    delete all[txId];
  } else {
    all[txId] = current;
  }
  saveAnnotations(all);
}

/** Get all unique tags across all annotated transactions. */
export function getAllTags(): string[] {
  const all = loadAnnotations();
  const tagSet = new Set<string>();
  for (const annotation of Object.values(all)) {
    for (const tag of annotation.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}