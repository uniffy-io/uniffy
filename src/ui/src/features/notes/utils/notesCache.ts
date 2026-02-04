/**
 * Notes IndexedDB Cache
 *
 * Provides persistent caching for notes data using raw IndexedDB.
 * Used for instant initial load while revalidating from API in background.
 */

import type { SerializedNote } from '@/features/notes/store/notesThunks';
import type { OrganizedNotes } from '@/features/notes/utils/notesTreeUtils';

const DB_NAME = 'uniffy-notes-cache';
const DB_VERSION = 1;
const STORE_NAME = 'notes-data';

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

  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[NotesCache] Failed to open IndexedDB:', request.error);
      dbInitPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle connection closing unexpectedly
      dbInstance.onclose = () => {
        dbInstance = null;
        dbInitPromise = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store with organizationId as key
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'organizationId' });
        // Index for querying by userId (for multi-user support)
        store.createIndex('userId', 'userId', { unique: false });
        // Index for querying by updatedAt (for cleanup)
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });

  return dbInitPromise;
}

/**
 * Get cached notes data for an organization.
 * Returns null if cache miss or expired.
 */
export async function getCachedNotes(
  organizationId: string,
  userId: string
): Promise<{ notes: SerializedNote[]; tree: OrganizedNotes; totalCount: number; isFresh: boolean } | null> {
  try {
    const db = await initDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(organizationId);

      request.onsuccess = () => {
        const entry = request.result as NotesCacheEntry | undefined;

        if (!entry) {
          resolve(null);
          return;
        }

        // Check if cache belongs to current user
        if (entry.userId !== userId) {
          resolve(null);
          return;
        }

        const age = Date.now() - entry.updatedAt;

        // Cache too old - treat as miss
        if (age > CACHE_MAX_AGE_MS) {
          resolve(null);
          return;
        }

        // Return cached data with freshness indicator
        resolve({
          notes: entry.notes,
          tree: entry.tree,
          totalCount: entry.totalCount,
          isFresh: age < CACHE_FRESH_MS,
        });
      };

      request.onerror = () => {
        console.error('[NotesCache] Failed to read cache:', request.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('[NotesCache] Cache read error:', error);
    return null;
  }
}

/**
 * Save notes data to cache.
 */
export async function setCachedNotes(
  organizationId: string,
  userId: string,
  notes: SerializedNote[],
  tree: OrganizedNotes,
  totalCount: number
): Promise<void> {
  try {
    const db = await initDB();

    const entry: NotesCacheEntry = {
      organizationId,
      userId,
      notes,
      tree,
      totalCount,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

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
 */
export async function updateCachedNote(
  organizationId: string,
  userId: string,
  note: SerializedNote,
  tree: OrganizedNotes
): Promise<void> {
  try {
    const db = await initDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(organizationId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result as NotesCacheEntry | undefined;

        if (!entry || entry.userId !== userId) {
          resolve();
          return;
        }

        // Update or add the note
        const noteIndex = entry.notes.findIndex((n) => n.id === note.id);
        if (noteIndex >= 0) {
          entry.notes[noteIndex] = note;
        } else {
          entry.notes.push(note);
          entry.totalCount++;
        }

        // Update tree
        entry.tree = tree;
        entry.updatedAt = Date.now();

        store.put(entry);
        resolve();
      };

      getRequest.onerror = () => resolve();
    });
  } catch (error) {
    console.error('[NotesCache] Cache update error:', error);
  }
}

/**
 * Remove a note from the cache.
 * Used after delete operations.
 */
export async function removeCachedNote(
  organizationId: string,
  userId: string,
  noteId: string,
  tree: OrganizedNotes,
  permanent: boolean
): Promise<void> {
  try {
    const db = await initDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(organizationId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result as NotesCacheEntry | undefined;

        if (!entry || entry.userId !== userId) {
          resolve();
          return;
        }

        if (permanent) {
          // Remove completely
          entry.notes = entry.notes.filter((n) => n.id !== noteId);
          entry.totalCount = Math.max(0, entry.totalCount - 1);
        } else {
          // Mark as deleted (soft delete)
          const note = entry.notes.find((n) => n.id === noteId);
          if (note) {
            note.isDeleted = true;
          }
        }

        // Update tree
        entry.tree = tree;
        entry.updatedAt = Date.now();

        store.put(entry);
        resolve();
      };

      getRequest.onerror = () => resolve();
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
