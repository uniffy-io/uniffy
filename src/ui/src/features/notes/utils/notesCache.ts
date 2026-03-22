/**
 * Notes IndexedDB Cache
 *
 * Provides persistent caching for notes data using raw IndexedDB.
 * Used for instant initial load while revalidating from API in background.
 *
 * All cached note content is encrypted at rest using the platform-wide
 * client-side storage encryption system (AES-256-GCM).
 * See docs/specs/client-storage-encryption-spec.md for details.
 */

import type { SerializedNote } from '@/features/notes/store/notesThunks';
import type { OrganizedNotes } from '@/features/notes/utils/notesTreeUtils';
import {
  encryptForStorage,
  decryptFromStorage,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
} from '@/shared/crypto/storageEncryption';

const DB_NAME = 'uniffy-notes-cache';
const DB_VERSION = 2; // Bumped: v2 stores encrypted ArrayBuffer values
const STORE_NAME = 'notes-data';

// Register this database so it's cleared on seed rotation / device clear
registerEncryptedDatabase(DB_NAME);

/** Cache entry structure */
interface NotesCacheEntry {
  /** Organization ID - used as primary key */
  organizationId: string;
  /** All notes for this organization */
  notes: SerializedNote[];
  /** Organized tree structure */
  tree: OrganizedNotes;
  /** Total count from API */
  totalCount: number;
  /** Timestamp when cache was last updated */
  updatedAt: number;
  /** User ID who owns this cache */
  userId: string;
}

/** How long cache is considered fresh (5 minutes) */
const CACHE_FRESH_MS = 5 * 60 * 1000;

/** How long cache is usable at all (24 hours) */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let dbInstance: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the IndexedDB database. If the store has an in-line keyPath
 * (leftover v1 schema that wasn't upgraded - e.g. upgrade blocked by another tab),
 * delete the entire database and re-open so the v2 schema is created fresh.
 */
function openOrRecreateDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[NotesCache] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn('[NotesCache] Database upgrade blocked by another tab');
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onclose = () => {
        dbInstance = null;
        dbInitPromise = null;
      };

      // Safety check: if the store still has a keyPath (v1 schema survived),
      // close, delete, and re-open to force a clean v2 schema.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        if (store.keyPath !== null) {
          db.close();
          const deleteReq = indexedDB.deleteDatabase(DB_NAME);
          deleteReq.onsuccess = () => {
            dbInitPromise = null;
            openOrRecreateDB().then(resolve, reject);
          };
          deleteReq.onerror = () => reject(deleteReq.error);
          return;
        }
      }

      dbInstance = db;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // v2: encrypted store uses out-of-line keys with ArrayBuffer values.
      // Delete old v1 plaintext store if upgrading.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }

      // No keyPath, no indexes - values are encrypted ArrayBuffers.
      db.createObjectStore(STORE_NAME);
    };
  });
}

/**
 * Initialize IndexedDB connection.
 * Returns cached connection if already open.
 */
function initDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = openOrRecreateDB();

  return dbInitPromise;
}

/**
 * Get cached notes data for an organization.
 * Returns null if cache miss, expired, or decryption fails.
 */
export async function getCachedNotes(
  organizationId: string,
  userId: string
): Promise<{ notes: SerializedNote[]; tree: OrganizedNotes; totalCount: number; isFresh: boolean } | null> {
  try {
    if (!isStorageEncryptionReady()) {
      return null;
    }

    const db = await initDB();

    const encrypted: ArrayBuffer | undefined = await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(organizationId);

      request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
      request.onerror = () => {
        console.error('[NotesCache] Failed to read cache:', request.error);
        resolve(undefined);
      };
    });

    if (!encrypted) {
      return null;
    }

    let entry: NotesCacheEntry;
    try {
      entry = await decryptFromStorage<NotesCacheEntry>(encrypted);
    } catch {
      // Decryption failed (corrupted entry or key rotated). Skip, don't nuke entire cache.
      console.warn('[NotesCache] Decryption failed for org', organizationId);
      return null;
    }

    // Check if cache belongs to current user
    if (entry.userId !== userId) {
      return null;
    }

    const age = Date.now() - entry.updatedAt;

    // Cache too old - treat as miss
    if (age > CACHE_MAX_AGE_MS) {
      return null;
    }

    // Return cached data with freshness indicator
    return {
      notes: entry.notes,
      tree: entry.tree,
      totalCount: entry.totalCount,
      isFresh: age < CACHE_FRESH_MS,
    };
  } catch (error) {
    console.error('[NotesCache] Cache read error:', error);
    return null;
  }
}

/**
 * Save notes data to cache (encrypted).
 */
export async function setCachedNotes(
  organizationId: string,
  userId: string,
  notes: SerializedNote[],
  tree: OrganizedNotes,
  totalCount: number
): Promise<void> {
  try {
    if (!isStorageEncryptionReady()) {
      return;
    }

    const db = await initDB();

    const entry: NotesCacheEntry = {
      organizationId,
      userId,
      notes,
      tree,
      totalCount,
      updatedAt: Date.now(),
    };

    const encrypted = await encryptForStorage(entry);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(encrypted, organizationId);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error('[NotesCache] Failed to write cache:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[NotesCache] Cache write error:', error);
  }
}

/**
 * Update a single note in the cache.
 * Used after create/update operations.
 * Reads, decrypts, modifies, re-encrypts, writes.
 */
export async function updateCachedNote(
  organizationId: string,
  userId: string,
  note: SerializedNote,
  tree: OrganizedNotes
): Promise<void> {
  try {
    if (!isStorageEncryptionReady()) {
      return;
    }

    const db = await initDB();

    const encrypted: ArrayBuffer | undefined = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(organizationId);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => resolve(undefined);
    });

    if (!encrypted) return;

    let entry: NotesCacheEntry;
    try {
      entry = await decryptFromStorage<NotesCacheEntry>(encrypted);
    } catch {
      return;
    }

    if (entry.userId !== userId) return;

    // Update or add the note
    const noteIndex = entry.notes.findIndex((n) => n.id === note.id);
    if (noteIndex >= 0) {
      entry.notes[noteIndex] = note;
    } else {
      entry.notes.push(note);
      entry.totalCount++;
    }

    entry.tree = tree;
    entry.updatedAt = Date.now();

    const reEncrypted = await encryptForStorage(entry);

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(reEncrypted, organizationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (error) {
    console.error('[NotesCache] Cache update error:', error);
  }
}

/**
 * Remove a note from the cache.
 * Used after delete operations.
 * Reads, decrypts, modifies, re-encrypts, writes.
 */
export async function removeCachedNote(
  organizationId: string,
  userId: string,
  noteId: string,
  tree: OrganizedNotes,
  permanent: boolean
): Promise<void> {
  try {
    if (!isStorageEncryptionReady()) {
      return;
    }

    const db = await initDB();

    const encrypted: ArrayBuffer | undefined = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(organizationId);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => resolve(undefined);
    });

    if (!encrypted) return;

    let entry: NotesCacheEntry;
    try {
      entry = await decryptFromStorage<NotesCacheEntry>(encrypted);
    } catch {
      return;
    }

    if (entry.userId !== userId) return;

    if (permanent) {
      entry.notes = entry.notes.filter((n) => n.id !== noteId);
      entry.totalCount = Math.max(0, entry.totalCount - 1);
    } else {
      const note = entry.notes.find((n) => n.id === noteId);
      if (note) {
        note.isDeleted = true;
      }
    }

    entry.tree = tree;
    entry.updatedAt = Date.now();

    const reEncrypted = await encryptForStorage(entry);

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(reEncrypted, organizationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (error) {
    console.error('[NotesCache] Cache remove error:', error);
  }
}

/**
 * Clear cache for an organization.
 */
export async function clearCachedNotes(organizationId: string): Promise<void> {
  try {
    const db = await initDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(organizationId);
      resolve();
    });
  } catch (error) {
    console.error('[NotesCache] Cache clear error:', error);
  }
}

/**
 * Clear all cached data (for logout).
 */
export async function clearAllCache(): Promise<void> {
  try {
    const db = await initDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      resolve();
    });
  } catch (error) {
    console.error('[NotesCache] Cache clear all error:', error);
  }
}

/**
 * Check if IndexedDB is available.
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
