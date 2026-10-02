import * as Y from "yjs";
import { openDB, type IDBPDatabase } from "idb";
import { docNameFor } from "@/features/realtime/docNames";
import { docGeneration } from "@/features/realtime/docGeneration";
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
const DB_VERSION = 3;
const UPDATES_STORE = "updates";
type UpdateKey = [string, string, string, string];

export const persistenceRecoveryStats = { generationMismatchRows: 0 };

registerEncryptedDatabase(DB_NAME);

let dbPromise: Promise<IDBPDatabase> | null = null;
const pendingDisposals = new Map<string, Promise<void>>();
export const RECOVERY_AVAILABLE_EVENT = "uniffy:realtime:recovery";
const recoveryKeys = new WeakMap<Y.Doc, { contentType: string; contentId: string }>();

export interface RecoveredDraft {
  generation: string;
  text: string;
  update: string;
}

export async function readRecoveredDrafts(ydoc: Y.Doc): Promise<RecoveredDraft[]> {
  const key = recoveryKeys.get(ydoc);
  if (!key || !isStorageEncryptionReady()) return [];
  const db = await getDB();
  const tx = db.transaction(UPDATES_STORE, "readonly");
  const store = tx.objectStore(UPDATES_STORE);
  const range = rangeFor(key.contentType, key.contentId);
  const [keys, blobs] = await Promise.all([store.getAllKeys(range), store.getAll(range), tx.done]);
  const documents = new Map<string, Y.Doc>();
  for (let index = 0; index < keys.length; index++) {
    const row = keys[index] as UpdateKey;
    if (row[2] === (docGeneration(ydoc) ?? "")) continue;
    const generation = row.length === 4 ? row[2] : "";
    const doc = documents.get(generation) ?? new Y.Doc();
    documents.set(generation, doc);
    try {
      Y.applyUpdate(doc, base64ToBytes(await decryptFromStorage<string>(blobs[index])));
    } catch {
      // Retain unreadable rows for later recovery with the matching key.
    }
  }
  return [...documents].map(([generation, doc]) => {
    const fragment = doc.getXmlFragment("prosemirror");
    const text =
      doc.getMap("markdown_mirror").get("active") && fragment.length
        ? fragment
            .toArray()
            .map((block) =>
              block instanceof Y.XmlText
                ? block.toString()
                : block instanceof Y.XmlElement
                  ? block
                      .toArray()
                      .map((child) => child.toString())
                      .join("")
                  : block.toString(),
            )
            .join("\n\n")
        : doc.getText("markdown").toString();
    const result = { generation, text, update: bytesToBase64(Y.encodeStateAsUpdate(doc)) };
    doc.destroy();
    return result;
  });
}

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!Array.from(db.objectStoreNames).includes(UPDATES_STORE))
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
  hydrate: (options?: { serverGeneration: string | null }) => Promise<void>;
  compact: () => Promise<void>;
  /** `discard` drops this doc's rows instead of compacting them; for closes the server fully holds. */
  destroy: (options?: { discard?: boolean }) => Promise<void>;
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
  recoveryKeys.set(ydoc, { contentType, contentId });
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

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (destroyed) return;
    if (!isPersistedOrigin(origin)) return;
    if (!isStorageEncryptionReady()) return;
    const pending = writeUpdate(Y.encodeStateAsUpdate(ydoc));
    pendingWrites.add(pending);
    void pending.finally(() => pendingWrites.delete(pending));
  };

  async function writeUpdate(update: Uint8Array): Promise<void> {
    // Counter allocation stays synchronous with the doc update, so any own
    // row at or below the counter compact() captures is inside its snapshot.
    const allocated = ++counter;
    const generation = docGeneration(ydoc) ?? "";
    try {
      const blob = await encryptForStorage(bytesToBase64(update));
      const db = await getDB();
      await db.put(UPDATES_STORE, blob, [
        contentType,
        contentId,
        generation,
        updateRowSeq(epoch, allocated),
      ]);
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

  async function hydrate(options?: { serverGeneration: string | null }): Promise<void> {
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
      if (!options) {
        const generations = new Set(
          (keys as UpdateKey[]).filter((key) => key.length === 4).map((key) => key[2]),
        );
        const current = docGeneration(ydoc);
        if (current !== null) options = { serverGeneration: current };
        else if (generations.size === 1) options = { serverGeneration: [...generations][0] };
        else return;
      }
      // The server value was captured before replay. Reading the merged map
      // here would let a stale local LWW entry decide whether it is current.
      const replayGeneration = options.serverGeneration ?? "";
      const rejected = (keys as UpdateKey[]).filter(
        (key) => key.length !== 4 || key[2] !== replayGeneration,
      );
      if (rejected.length > 0) {
        persistenceRecoveryStats.generationMismatchRows += rejected.length;
        console.warn("[realtime] retained recovery rows from another generation", {
          docKey,
          rows: rejected.length,
        });
        window.dispatchEvent(new Event(RECOVERY_AVAILABLE_EVENT));
      }
      for (let i = 0; i < blobs.length; i++) {
        const key = keys[i] as UpdateKey;
        if (key.length !== 4 || key[2] !== replayGeneration) continue;
        try {
          const encoded = await decryptFromStorage<string>(blobs[i]);
          if (destroyed) return;
          const bytes = base64ToBytes(encoded);
          if (bytes.length > 0) Y.applyUpdate(ydoc, bytes, HYDRATION_ORIGIN);
          hydratedSeqs.add(key[3]);
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
      const generation = docGeneration(ydoc) ?? "";
      const snapshot = Y.encodeStateAsUpdate(ydoc);
      const blob = await encryptForStorage(bytesToBase64(snapshot));
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, "readwrite");
      const store = tx.objectStore(UPDATES_STORE);
      const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
      const removable = selectCompactableSeqs(
        keys.filter((key) => key[2] === generation).map((key) => key[3]),
        epoch,
        snapshotCounter,
        hydratedSeqs,
      );
      await Promise.all([
        ...removable.map((seq) => store.delete([contentType, contentId, generation, seq])),
        store.put(blob, [contentType, contentId, generation, updateRowSeq(epoch, ++counter)]),
        tx.done,
      ]);
      for (const seq of removable) hydratedSeqs.delete(seq);
    } catch (err) {
      console.warn("[realtime] encrypted persistence compact failed", err);
    }
  }

  async function clear(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    try {
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, "readwrite");
      const store = tx.objectStore(UPDATES_STORE);
      const generation = docGeneration(ydoc) ?? "";
      const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
      const removable = selectCompactableSeqs(
        keys.filter((key) => key[2] === generation).map((key) => key[3]),
        epoch,
        counter,
        hydratedSeqs,
      );
      await Promise.all([
        ...removable.map((seq) => store.delete([contentType, contentId, generation, seq])),
        tx.done,
      ]);
      hydratedSeqs.clear();
    } catch (err) {
      console.warn("[realtime] encrypted persistence clear failed", err);
    }
  }

  function destroy(options?: { discard?: boolean }): Promise<void> {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    ydoc.off("update", onUpdate);
    window.removeEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
    window.removeEventListener(ENCRYPTION_TEARDOWN_EVENT, handleTeardown);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    const finish = options?.discard ? clear : compact;
    const disposal = Promise.all([...pendingWrites]).then(() => finish());
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
