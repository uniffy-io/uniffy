import * as Y from "yjs";
import { openDB, type IDBPDatabase } from "idb";
import { docNameFor } from "@/features/realtime/docNames";
import { randomUUID } from "@/shared/utils/uuid";
import {
  ENCRYPTION_REKEY_EVENT,
  ENCRYPTION_TEARDOWN_EVENT,
  decryptFromStorage,
  encryptForStorage,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
} from "@/shared/crypto/storageEncryption";

const DB_NAME = "uniffy-realtime-yjs";
// Rebuildable cache: a key-shape change bumps the version and the upgrade
// wipes the stores instead of migrating rows.
const DB_VERSION = 2;
const UPDATES_STORE = "updates";

registerEncryptedDatabase(DB_NAME);

let dbPromise: Promise<IDBPDatabase> | null = null;
const pendingDisposals = new Map<string, Promise<void>>();

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }
        db.createObjectStore(UPDATES_STORE);
      },
    });
  }
  return dbPromise;
}

export const HYDRATION_ORIGIN = Symbol("uniffy.realtime.hydration");
export const REMOTE_ORIGIN = Symbol("uniffy.realtime.remote");
// The editor's Y.Text("markdown") mirror re-derives its content from the
// persisted fragment and also fires for remote ySync transactions, so
// persisting it would write peer edits into local IDB.
export const MARKDOWN_MIRROR_ORIGIN = Symbol("uniffy.realtime.markdownMirror");

export function isPersistedOrigin(origin: unknown): boolean {
  return (
    origin !== HYDRATION_ORIGIN && origin !== REMOTE_ORIGIN && origin !== MARKDOWN_MIRROR_ORIGIN
  );
}

// A random epoch per attach keys this session's rows, so a fresh attach or a
// concurrent tab can never overwrite another session's rows.
export function newPersistenceEpoch(): string {
  return randomUUID();
}

// Yjs updates are commutative, so replay order across epochs does not matter;
// zero-padding keeps one epoch's rows in write order anyway.
export function updateRowSeq(epoch: string, counter: number): string {
  return `${epoch}:${String(counter).padStart(10, "0")}`;
}

// A row may be folded into a snapshot only when its content is provably in
// this session's ydoc: rows replayed by hydrate, plus this epoch's own rows up
// to the counter captured when the snapshot was encoded.
export function selectCompactableSeqs(
  seqs: readonly string[],
  epoch: string,
  maxOwnCounter: number,
  hydratedSeqs: ReadonlySet<string>,
): string[] {
  const ownPrefix = `${epoch}:`;
  return seqs.filter((seq) => {
    if (hydratedSeqs.has(seq)) return true;
    if (!seq.startsWith(ownPrefix)) return false;
    return Number(seq.slice(ownPrefix.length)) <= maxOwnCounter;
  });
}

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
  // The third key component is always a string; an empty array sorts after
  // every string in IndexedDB key order.
  return IDBKeyRange.bound([contentType, contentId], [contentType, contentId, []]);
}

export function attachEncryptedPersistence(
  opts: EncryptedPersistenceOptions,
): EncryptedPersistence {
  const { contentType, contentId, ydoc } = opts;
  const docKey = docNameFor(contentType, contentId);
  const previousDisposal = pendingDisposals.get(docKey);
  const compactEvery = opts.compactEvery ?? 100;

  const epoch = newPersistenceEpoch();
  let counter = 0;
  const hydratedSeqs = new Set<string>();
  let pendingCompact = false;
  let destroyed = false;
  let destroyPromise: Promise<void> | null = null;
  const pendingWrites = new Set<Promise<void>>();

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (destroyed) return;
    if (!isPersistedOrigin(origin)) return;
    if (!isStorageEncryptionReady()) return;
    const pending = writeUpdate(update);
    pendingWrites.add(pending);
    void pending.finally(() => pendingWrites.delete(pending));
  };

  async function writeUpdate(update: Uint8Array): Promise<void> {
    // Counter allocation stays synchronous with the doc update, so any own
    // row at or below the counter compact() captures is inside its snapshot.
    const allocated = ++counter;
    try {
      const blob = await encryptForStorage(bytesToBase64(update));
      const db = await getDB();
      await db.put(UPDATES_STORE, blob, [contentType, contentId, updateRowSeq(epoch, allocated)]);
      if (allocated % compactEvery === 0 && !pendingCompact) {
        pendingCompact = true;
        queueMicrotask(() => {
          pendingCompact = false;
          void compact();
        });
      }
    } catch (err) {
      console.warn("[realtime] encrypted persistence write failed", err);
    }
  }

  async function hydrate(): Promise<void> {
    await previousDisposal;
    if (destroyed) return;
    if (!isStorageEncryptionReady()) return;
    try {
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, "readonly");
      const store = tx.objectStore(UPDATES_STORE);
      const range = rangeFor(contentType, contentId);
      const [keys, blobs] = await Promise.all([
        store.getAllKeys(range),
        store.getAll(range),
        tx.done,
      ]);
      for (let i = 0; i < blobs.length; i++) {
        try {
          const encoded = await decryptFromStorage<string>(blobs[i]);
          if (destroyed) return;
          const bytes = base64ToBytes(encoded);
          if (bytes.length > 0) Y.applyUpdate(ydoc, bytes, HYDRATION_ORIGIN);
          const key = keys[i] as [string, string, string];
          hydratedSeqs.add(key[2]);
        } catch {
          // Skip rows that fail to decrypt (rotated DEK, corruption). They
          // also stay out of hydratedSeqs, so compact never deletes content
          // this session has not applied.
        }
      }
    } catch (err) {
      console.warn("[realtime] encrypted persistence hydrate failed", err);
    }
  }

  async function compact(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    try {
      // Captured before the encode: any own row at or below this counter was
      // applied to the ydoc first, so the snapshot subsumes it. Rows outside
      // the selection (another tab's live writes, an own write landing after
      // this transaction) are left in place and re-applied by a later
      // hydrate, which is safe because Yjs updates are idempotent.
      const snapshotCounter = counter;
      const snapshot = Y.encodeStateAsUpdate(ydoc);
      const blob = await encryptForStorage(bytesToBase64(snapshot));
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, "readwrite");
      const store = tx.objectStore(UPDATES_STORE);
      const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as [
        string,
        string,
        string,
      ][];
      const removable = selectCompactableSeqs(
        keys.map((key) => key[2]),
        epoch,
        snapshotCounter,
        hydratedSeqs,
      );
      await Promise.all([
        ...removable.map((seq) => store.delete([contentType, contentId, seq])),
        store.put(blob, [contentType, contentId, updateRowSeq(epoch, ++counter)]),
        tx.done,
      ]);
      for (const seq of removable) hydratedSeqs.delete(seq);
    } catch (err) {
      console.warn("[realtime] encrypted persistence compact failed", err);
    }
  }

  function destroy(): Promise<void> {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    ydoc.off("update", onUpdate);
    window.removeEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
    window.removeEventListener(ENCRYPTION_TEARDOWN_EVENT, handleTeardown);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    const disposal = Promise.all([...pendingWrites]).then(() => compact());
    pendingDisposals.set(docKey, disposal);
    destroyPromise = disposal.finally(() => {
      if (pendingDisposals.get(docKey) === disposal) pendingDisposals.delete(docKey);
    });
    return destroyPromise;
  }

  const handleRekey = () => {
    // The rekey path wipes the whole DB, so seqs recorded by hydrate no
    // longer exist; a fresh snapshot re-seeds the store under the new DEK.
    hydratedSeqs.clear();
    void compact();
  };
  const handleTeardown = () => {
    // DEK gone; further writes are no-ops via isStorageEncryptionReady.
  };
  const handleBeforeUnload = () => {
    void compact();
  };

  ydoc.on("update", onUpdate);
  window.addEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
  window.addEventListener(ENCRYPTION_TEARDOWN_EVENT, handleTeardown);
  window.addEventListener("beforeunload", handleBeforeUnload);

  return { hydrate, compact, destroy };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
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
