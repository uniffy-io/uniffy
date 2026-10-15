// Docs closed with local edits the server has not acknowledged. The drain replays them from
// IndexedDB on the next connection, whichever editor is open then.

import { docNameFor } from "@/features/realtime/docNames";

const STORAGE_KEY = "uniffy:realtime:pending-docs";

export interface PendingDoc {
  contentType: string;
  contentId: string;
  organizationId: string;
  userId: string;
  /** Mirrors the session's `discardLocalOnCleanClose`: drop the rows once the server holds them. */
  discardOnClean: boolean;
}

const listeners = new Set<() => void>();
let cache: PendingDoc[] | null = null;
let storageListenerAttached = false;

function isPendingDoc(value: unknown): value is PendingDoc {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.contentType === "string" &&
    typeof entry.contentId === "string" &&
    typeof entry.organizationId === "string" &&
    typeof entry.userId === "string" &&
    typeof entry.discardOnClean === "boolean"
  );
}

function read(): PendingDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPendingDoc) : [];
  } catch {
    return [];
  }
}

function write(entries: PendingDoc[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the in-memory list still drives this tab.
  }
  cache = entries;
  for (const listener of listeners) listener();
}

const handleStorage = (event: StorageEvent) => {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = null;
  for (const listener of listeners) listener();
};

/** Stable reference until the next change, so it can back `useSyncExternalStore`. */
export function listPendingDocs(): PendingDoc[] {
  if (cache === null) cache = read();
  return cache;
}

export function hasPendingDoc(contentType: string, contentId: string): boolean {
  return listPendingDocs().some(
    (entry) => entry.contentType === contentType && entry.contentId === contentId,
  );
}

export function hasPendingDocs(userId: string): boolean {
  return listPendingDocs().some((entry) => entry.userId === userId);
}

export function recordPendingDoc(entry: PendingDoc): void {
  const docName = docNameFor(entry.contentType, entry.contentId);
  const rest = listPendingDocs().filter(
    (existing) => docNameFor(existing.contentType, existing.contentId) !== docName,
  );
  write([...rest, entry]);
}

export function clearPendingDoc(contentType: string, contentId: string): void {
  const docName = docNameFor(contentType, contentId);
  const current = listPendingDocs();
  const rest = current.filter(
    (existing) => docNameFor(existing.contentType, existing.contentId) !== docName,
  );
  if (rest.length !== current.length) write(rest);
}

export function clearPendingDocsFor(userId: string): void {
  const current = listPendingDocs();
  const rest = current.filter((entry) => entry.userId !== userId);
  if (rest.length !== current.length) write(rest);
}

export function subscribePendingDocs(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== "undefined") {
    storageListenerAttached = true;
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(listener);
  };
}
