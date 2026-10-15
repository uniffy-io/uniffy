import * as Y from "yjs";
import { getStoreRef } from "@/app/storeRef";
import { openDB, type IDBPDatabase } from "idb";
import { docNameFor } from "@/features/realtime/docNames";
import { docGeneration } from "@/features/realtime/docGeneration";
import {
  MARKDOWN_MIRROR_FIELD,
  MARKDOWN_TEXT_FIELD,
  MIRROR_ACTIVE_KEY,
  PROSEMIRROR_FRAGMENT_FIELD,
  changedUnprojectedRoots,
  contentProjection,
} from "@/features/realtime/docContent";
import { randomUUID } from "@/shared/utils/uuid";
import { recordPendingDoc, type PendingDoc } from "@/features/realtime/pendingDocs";
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
const RECOVERY_GENERATION_PREFIX = "recovery:";
type UpdateKey = [string, string, string, string];

export const persistenceRecoveryStats = { generationMismatchRows: 0 };

const allPendingWrites = new Set<Promise<void>>();

registerEncryptedDatabase(DB_NAME, async () => {
  await Promise.allSettled([...allPendingWrites, ...pendingDisposals.values()]);
  const pending = dbPromise;
  dbPromise = null;
  (await pending)?.close();
});

let dbPromise: Promise<IDBPDatabase> | null = null;
const pendingDisposals = new Map<string, Promise<void>>();
export const RECOVERY_AVAILABLE_EVENT = "uniffy:realtime:recovery";
const memoryRecovery = new Map<string, Map<string, RecoveredDraft>>();
const discardedRecovery = new WeakMap<Y.Doc, Set<string>>();
const recoveryKeys = new WeakMap<
  Y.Doc,
  { contentType: string; contentId: string; owner: string }
>();

export interface RecoveredDraft {
  generation: string;
  text: string;
  update: string;
  hasFragment?: boolean;
}

// `dirty` records that a local user edit went into this row's document, as opposed to
// hydration, seed, mirror or editor normalization writes. Only dirty rows are offered as drafts.
interface RowPayload {
  update: string;
  dirty: boolean;
  scope?: PendingDoc;
}

export async function discoverStoredPendingDocs(userId: string): Promise<boolean> {
  if (!isStorageEncryptionReady()) return false;
  const db = await getDB();
  const tx = db.transaction(UPDATES_STORE, "readonly");
  const blobs = await tx.objectStore(UPDATES_STORE).getAll();
  await tx.done;
  let pending = false;
  for (const blob of blobs) {
    try {
      const payload = await decryptFromStorage<RowPayload>(blob);
      const decoded = decodeRowPayload(payload);
      if (!decoded?.dirty || (payload.scope && payload.scope.userId !== userId)) continue;
      pending = true;
      if (payload.scope) recordPendingDoc(payload.scope);
    } catch {
      // Another user's encrypted rows cannot authorize a replay in this session.
    }
  }
  return pending;
}

function decodeRowPayload(payload: unknown): { update: Uint8Array; dirty: boolean } | null {
  // Rows written before the marker existed carry a bare string; they stay recoverable.
  if (typeof payload === "string") return { update: base64ToBytes(payload), dirty: true };
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as RowPayload).update === "string"
  ) {
    const row = payload as RowPayload;
    return { update: base64ToBytes(row.update), dirty: Boolean(row.dirty) };
  }
  return null;
}

function rowGeneration(key: UpdateKey | string[]): string {
  return key.length === 4 ? key[2] : "";
}

/** Drafts from other generations that hold a local user edit. Undecryptable rows and text-less documents are never listed. */
export async function readRecoveredDrafts(ydoc: Y.Doc): Promise<RecoveredDraft[]> {
  const key = recoveryKeys.get(ydoc);
  if (!key || docGeneration(ydoc) === null) return [];
  const retained = [
    ...(memoryRecovery
      .get(`${key.owner}:${docNameFor(key.contentType, key.contentId)}`)
      ?.values() ?? []),
  ];
  if (!isStorageEncryptionReady()) return retained;
  const db = await getDB();
  const tx = db.transaction(UPDATES_STORE, "readonly");
  const store = tx.objectStore(UPDATES_STORE);
  const range = rangeFor(key.contentType, key.contentId);
  const [keys, blobs] = await Promise.all([store.getAllKeys(range), store.getAll(range), tx.done]);
  const current = docGeneration(ydoc);
  if (current === null) return [];
  const documents = new Map<string, { doc: Y.Doc; dirty: boolean }>();
  for (let index = 0; index < keys.length; index++) {
    const generation = rowGeneration(keys[index] as UpdateKey);
    if (generation === current) continue;
    let decoded: ReturnType<typeof decodeRowPayload>;
    try {
      decoded = decodeRowPayload(await decryptFromStorage(blobs[index]));
    } catch {
      // Retain unreadable rows for later recovery with the matching key.
      continue;
    }
    if (!decoded) continue;
    const entry = documents.get(generation) ?? { doc: new Y.Doc(), dirty: false };
    documents.set(generation, entry);
    try {
      Y.applyUpdate(entry.doc, decoded.update);
      entry.dirty ||= decoded.dirty;
    } catch {
      // Corrupt bytes contribute nothing to the draft.
    }
  }
  const drafts: RecoveredDraft[] = [];
  for (const [generation, entry] of documents) {
    const text = entry.doc.getText(MARKDOWN_TEXT_FIELD).toString();
    const hasFragment =
      entry.doc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY) !== false &&
      entry.doc.getXmlFragment(PROSEMIRROR_FRAGMENT_FIELD).length > 0;
    if (entry.dirty && (text.trim().length > 0 || hasFragment)) {
      drafts.push({
        generation,
        text,
        hasFragment,
        update: bytesToBase64(Y.encodeStateAsUpdate(entry.doc)),
      });
    }
    entry.doc.destroy();
  }
  return [
    ...drafts,
    ...retained.filter((draft) => !drafts.some((saved) => saved.generation === draft.generation)),
  ];
}

/** Deletes every row of one generation for the document bound to `ydoc`. */
export async function discardRecoveredDraft(ydoc: Y.Doc, generation: string): Promise<void> {
  const key = recoveryKeys.get(ydoc);
  if (!key) return;
  const discarded = discardedRecovery.get(ydoc) ?? new Set<string>();
  discarded.add(generation);
  discardedRecovery.set(ydoc, discarded);
  memoryRecovery
    .get(`${key.owner}:${docNameFor(key.contentType, key.contentId)}`)
    ?.delete(generation);
  if (!isStorageEncryptionReady()) return;
  const db = await getDB();
  const tx = db.transaction(UPDATES_STORE, "readwrite");
  const store = tx.objectStore(UPDATES_STORE);
  const keys = (await store.getAllKeys(rangeFor(key.contentType, key.contentId))) as UpdateKey[];
  await Promise.all([
    ...keys.filter((row) => rowGeneration(row) === generation).map((row) => store.delete(row)),
    tx.done,
  ]);
}

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!Array.from(db.objectStoreNames).includes(UPDATES_STORE))
          db.createObjectStore(UPDATES_STORE);
      },
      blocking() {
        const pending = dbPromise;
        dbPromise = null;
        void pending?.then((db) => db.close());
      },
      terminated() {
        dbPromise = null;
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
  scope?: PendingDoc;
  /** True while the server holds every local frame; snapshots taken then are a cache, not a draft. */
  isAcknowledged?: () => boolean;
}

export interface EncryptedPersistence {
  acknowledge: () => Promise<void>;
  hydrate: (options?: { serverGeneration: string | null }) => Promise<void>;
  compact: () => Promise<void>;
  quarantine: () => Promise<boolean>;
  /** True once a local user edit changed document content in this session or in a hydrated row. */
  isDirty: () => boolean;
  /** `discard` drops this doc's rows instead of compacting them; `acknowledged` marks the
   * compacted snapshot as server-held so it is never offered as a draft. */
  destroy: (options?: { discard?: boolean; acknowledged?: boolean }) => Promise<void>;
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
  const owner = getStoreRef()?.getState().auth.user?.id ?? "";
  recoveryKeys.set(ydoc, { contentType, contentId, owner });
  const recoveryKey = `${owner}:${docNameFor(contentType, contentId)}`;
  const docKey = docNameFor(contentType, contentId);
  const previousDisposal = pendingDisposals.get(docKey);
  const compactEvery = opts.compactEvery ?? 100;

  const epoch = newPersistenceEpoch();
  let counter = 0;
  let localUpdates = 0;
  let recoveryGeneration: string | null = null;
  const storageGeneration = () => recoveryGeneration ?? docGeneration(ydoc) ?? "";
  let dirty = false;
  let hydratedDirty = false;
  let beforeText: string | null = null;
  let acknowledgedClose = false;
  const hydratedSeqs = new Set<string>();
  let pendingCompact = false;
  let destroyed = false;
  let destroyPromise: Promise<void> | null = null;
  const pendingWrites = new Set<Promise<void>>();
  let writeRequested = false;
  let writeLoop: Promise<void> | null = null;

  const rowDirty = (acknowledged: boolean) => (dirty || hydratedDirty) && !acknowledged;

  const onBeforeTransaction = (transaction: Y.Transaction) => {
    if (destroyed || dirty || !isPersistedOrigin(transaction.origin)) return;
    beforeText = contentProjection(ydoc);
  };

  const onUpdate = (
    _update: Uint8Array,
    origin: unknown,
    _doc: Y.Doc,
    transaction: Y.Transaction,
  ) => {
    if (destroyed) return;
    if (!isPersistedOrigin(origin)) return;
    localUpdates++;
    if (!dirty) {
      dirty =
        (beforeText !== null && contentProjection(ydoc) !== beforeText) ||
        changedUnprojectedRoots(ydoc, transaction);
    }
    beforeText = null;
    if (!isStorageEncryptionReady()) return;
    writeRequested = true;
    if (writeLoop) return;
    const pending = (async () => {
      do {
        writeRequested = false;
        await writeUpdate(Y.encodeStateAsUpdate(ydoc));
      } while (writeRequested);
    })();
    writeLoop = pending;
    pendingWrites.add(pending);
    allPendingWrites.add(pending);
    void pending.finally(() => {
      pendingWrites.delete(pending);
      allPendingWrites.delete(pending);
      writeLoop = null;
    });
  };

  function encodeRow(
    update: Uint8Array,
    acknowledged = acknowledgedClose || (!destroyed && (opts.isAcknowledged?.() ?? false)),
  ): RowPayload {
    return { update: bytesToBase64(update), dirty: rowDirty(acknowledged), scope: opts.scope };
  }

  async function writeUpdate(update: Uint8Array): Promise<void> {
    // Counter allocation stays synchronous with the doc update, so any own
    // row at or below the counter compact() captures is inside its snapshot.
    const allocated = ++counter;
    const generation = storageGeneration();
    if (discardedRecovery.get(ydoc)?.has(generation)) return;
    try {
      const blob = await encryptForStorage(encodeRow(update, false));
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, "readwrite");
      const store = tx.objectStore(UPDATES_STORE);
      const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
      const prior = selectCompactableSeqs(
        keys.filter((key) => key[2] === generation).map((key) => key[3]),
        epoch,
        allocated,
        new Set(),
      );
      await Promise.all([
        ...prior.map((seq) => store.delete([contentType, contentId, generation, seq])),
        store.put(blob, [contentType, contentId, generation, updateRowSeq(epoch, allocated)]),
        tx.done,
      ]);
      if (opts.scope && (dirty || hydratedDirty)) recordPendingDoc(opts.scope);
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

  let hydration = Promise.resolve();
  function hydrate(options?: { serverGeneration: string | null }): Promise<void> {
    hydration = hydration.then(() => hydrateRows(options));
    return hydration;
  }

  async function hydrateRows(options?: { serverGeneration: string | null }): Promise<void> {
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
          (keys as UpdateKey[])
            .filter((key) => key.length === 4 && !key[2].startsWith(RECOVERY_GENERATION_PREFIX))
            .map((key) => key[2]),
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
        if (
          key.length !== 4 ||
          key[2] !== replayGeneration ||
          key[2].startsWith(RECOVERY_GENERATION_PREFIX)
        )
          continue;
        try {
          const decoded = decodeRowPayload(await decryptFromStorage(blobs[i]));
          if (destroyed) return;
          if (!decoded) continue;
          if (decoded.update.length > 0) Y.applyUpdate(ydoc, decoded.update, HYDRATION_ORIGIN);
          hydratedSeqs.add(key[3]);
          hydratedDirty ||= decoded.dirty;
        } catch {
          // Skip rows that fail to decrypt (rotated DEK, corruption). They
          // also stay out of hydratedSeqs, so compact never deletes content
          // this session has not applied.
        }
      }
    } catch (err) {
      console.warn("[realtime] encrypted persistence hydrate failed", err);
      throw err;
    }
  }

  async function quarantine(): Promise<boolean> {
    await hydration.catch(() => {});
    const previousGeneration = storageGeneration();
    recoveryGeneration = `${RECOVERY_GENERATION_PREFIX}${randomUUID()}`;
    const update = bytesToBase64(Y.encodeStateAsUpdate(ydoc));
    const retained = memoryRecovery.get(recoveryKey) ?? new Map<string, RecoveredDraft>();
    memoryRecovery.set(recoveryKey, retained);
    retained.set(recoveryGeneration, {
      generation: recoveryGeneration,
      update,
      text: ydoc.getText(MARKDOWN_TEXT_FIELD).toString(),
      hasFragment:
        ydoc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY) !== false &&
        ydoc.getXmlFragment(PROSEMIRROR_FRAGMENT_FIELD).length > 0,
    });
    dirty = true;
    try {
      await Promise.all([...pendingWrites]);
      if (isStorageEncryptionReady()) {
        const blob = await encryptForStorage({ update, dirty: true });
        const db = await getDB();
        const tx = db.transaction(UPDATES_STORE, "readwrite");
        const store = tx.objectStore(UPDATES_STORE);
        const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
        const removable = selectCompactableSeqs(
          keys.filter((key) => key[2] === previousGeneration).map((key) => key[3]),
          epoch,
          counter,
          hydratedSeqs,
        );
        await Promise.all([
          ...removable.map((seq) =>
            store.delete([contentType, contentId, previousGeneration, seq]),
          ),
          store.put(blob, [
            contentType,
            contentId,
            recoveryGeneration,
            updateRowSeq(epoch, ++counter),
          ]),
          tx.done,
        ]);
        hydratedSeqs.clear();
      }
      window.dispatchEvent(new Event(RECOVERY_AVAILABLE_EVENT));
      return true;
    } catch (error) {
      console.warn("[realtime] could not isolate rejected draft", error);
      window.dispatchEvent(new Event(RECOVERY_AVAILABLE_EVENT));
      return false;
    }
  }

  async function compact(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    if (discardedRecovery.get(ydoc)?.has(storageGeneration())) return;
    // Nothing local happened: no edit, no hydrated row. A snapshot would only
    // add a row of server state that later reads as a phantom draft.
    if (localUpdates === 0 && hydratedSeqs.size === 0) return;
    try {
      // Captured before the encode: any own row at or below this counter was
      // applied to the ydoc first, so the snapshot subsumes it. Rows outside
      // the selection (another tab's live writes, an own write landing after
      // this transaction) are left in place and re-applied by a later
      // hydrate, which is safe because Yjs updates are idempotent.
      const snapshotCounter = counter;
      const generation = storageGeneration();
      const snapshot = Y.encodeStateAsUpdate(ydoc);
      const blob = await encryptForStorage(encodeRow(snapshot));
      if (generation !== storageGeneration()) return;
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
      const generation = storageGeneration();
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

  function destroy(options?: { discard?: boolean; acknowledged?: boolean }): Promise<void> {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    acknowledgedClose = Boolean(options?.acknowledged);
    ydoc.off("beforeTransaction", onBeforeTransaction);
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

  ydoc.on("beforeTransaction", onBeforeTransaction);
  ydoc.on("update", onUpdate);
  window.addEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
  window.addEventListener(ENCRYPTION_TEARDOWN_EVENT, handleTeardown);
  window.addEventListener("beforeunload", handleBeforeUnload);

  const acknowledge = async () => {
    await Promise.all([...pendingWrites]);
    if (!destroyed && opts.isAcknowledged?.()) await compact();
  };
  return {
    hydrate,
    compact,
    acknowledge,
    quarantine,
    isDirty: () => dirty || hydratedDirty,
    destroy,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
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
