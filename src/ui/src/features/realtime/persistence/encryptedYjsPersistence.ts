import * as Y from 'yjs';
import { openDB, type IDBPDatabase } from 'idb';
import {
  ENCRYPTION_REKEY_EVENT,
  ENCRYPTION_TEARDOWN_EVENT,
  decryptFromStorage,
  encryptForStorage,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
} from '@/shared/crypto/storageEncryption';

const DB_NAME = 'uniffy-realtime-yjs';
const DB_VERSION = 1;
const UPDATES_STORE = 'updates';
const META_STORE = 'meta';

registerEncryptedDatabase(DB_NAME);

interface PersistenceMeta {
  lastSeq: number;
  lastCompactAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(UPDATES_STORE)) {
          db.createObjectStore(UPDATES_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export const HYDRATION_ORIGIN = Symbol('uniffy.realtime.hydration');
export const REMOTE_ORIGIN = Symbol('uniffy.realtime.remote');

export interface EncryptedPersistenceOptions {
  contentType: string;
  contentId: string;
  ydoc: Y.Doc;
  compactEvery?: number;
}

export interface EncryptedPersistence {
  hydrate: () => Promise<void>;
  compact: () => Promise<void>;
  destroy: () => Promise<void>;
}

function rangeFor(contentType: string, contentId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [contentType, contentId],
    [contentType, contentId, Number.MAX_SAFE_INTEGER],
  );
}

export function attachEncryptedPersistence(
  opts: EncryptedPersistenceOptions,
): EncryptedPersistence {
  const { contentType, contentId, ydoc } = opts;
  const compactEvery = opts.compactEvery ?? 100;

  let seq = 0;
  let pendingCompact = false;
  let destroyed = false;

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (destroyed) return;
    if (origin === REMOTE_ORIGIN || origin === HYDRATION_ORIGIN) return;
    if (!isStorageEncryptionReady()) return;
    void writeUpdate(update);
  };

  async function writeUpdate(update: Uint8Array): Promise<void> {
    try {
      const blob = await encryptForStorage(bytesToBase64(update));
      const db = await getDB();
      const next = ++seq;
      await db.put(UPDATES_STORE, blob, [contentType, contentId, next]);
      if (next % compactEvery === 0 && !pendingCompact) {
        pendingCompact = true;
        queueMicrotask(() => {
          pendingCompact = false;
          void compact();
        });
      }
    } catch (err) {
      console.warn('[realtime] encrypted persistence write failed', err);
    }
  }

  async function readMeta(): Promise<PersistenceMeta | null> {
    try {
      const db = await getDB();
      const blob = await db.get(META_STORE, [contentType, contentId]);
      if (!blob) return null;
      return await decryptFromStorage<PersistenceMeta>(blob);
    } catch {
      return null;
    }
  }

  async function writeMeta(meta: PersistenceMeta): Promise<void> {
    try {
      const blob = await encryptForStorage(meta);
      const db = await getDB();
      await db.put(META_STORE, blob, [contentType, contentId]);
    } catch {
      // ignore
    }
  }

  async function hydrate(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    try {
      const meta = await readMeta();
      if (meta) seq = meta.lastSeq;

      const db = await getDB();
      const blobs = await db.getAll(UPDATES_STORE, rangeFor(contentType, contentId));
      for (const blob of blobs) {
        try {
          const encoded = await decryptFromStorage<string>(blob);
          const bytes = base64ToBytes(encoded);
          if (bytes.length > 0) Y.applyUpdate(ydoc, bytes, HYDRATION_ORIGIN);
        } catch {
          // skip rows that fail to decrypt (rotated DEK, corruption)
        }
      }
    } catch (err) {
      console.warn('[realtime] encrypted persistence hydrate failed', err);
    }
  }

  async function compact(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    try {
      const snapshot = Y.encodeStateAsUpdate(ydoc);
      const blob = await encryptForStorage(bytesToBase64(snapshot));
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, 'readwrite');
      const store = tx.objectStore(UPDATES_STORE);
      let cursor = await store.openCursor(rangeFor(contentType, contentId));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      seq = 1;
      await store.put(blob, [contentType, contentId, seq]);
      await tx.done;
      await writeMeta({ lastSeq: seq, lastCompactAt: Date.now() });
    } catch (err) {
      console.warn('[realtime] encrypted persistence compact failed', err);
    }
  }

  async function destroy(): Promise<void> {
    if (destroyed) return;
    destroyed = true;
    ydoc.off('update', onUpdate);
    window.removeEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
    window.removeEventListener(ENCRYPTION_TEARDOWN_EVENT, handleTeardown);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }

  const handleRekey = () => {
    seq = 0;
    void compact();
  };
  const handleTeardown = () => {
    // DEK gone; further writes are no-ops via isStorageEncryptionReady.
  };
  const handleBeforeUnload = () => {
    void compact();
  };

  ydoc.on('update', onUpdate);
  window.addEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
  window.addEventListener(ENCRYPTION_TEARDOWN_EVENT, handleTeardown);
  window.addEventListener('beforeunload', handleBeforeUnload);

  return { hydrate, compact, destroy };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
