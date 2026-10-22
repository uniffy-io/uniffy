/** Scoped upload metadata and encrypted file and recording bytes for reload recovery. */

import { openDB, type IDBPDatabase } from "idb";
import { getUploadScope, sameUploadScope } from "@/features/files/upload/uploadScope";
import type { UploadRecord, UploadScope } from "@/features/files/upload/uploadTypes";
import {
  decryptBytesFromStorage,
  encryptBytesForStorage,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
} from "@/shared/crypto/storageEncryption";

const DB_NAME = "uniffy-uploads";
const DB_VERSION = 2;
const RECORDS_STORE = "records";
const BLOBS_STORE = "blobs";
const CHUNKS_STORE = "chunks";

const TERMINAL_STATUSES: ReadonlySet<UploadRecord["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/** Owner stamp on every stored row. A row without a userId is never resumed. */
export interface StoredRowOwner {
  userId?: string;
  organizationId?: string;
}

type BlobOwner = Pick<UploadRecord, "id" | "userId" | "organizationId">;

interface BlobRow extends StoredRowOwner {
  id: string;
  /** [12-byte IV | AES-GCM ciphertext] bound to the owner and id. */
  data: ArrayBuffer;
  type: string;
}

const blobAdditionalData = (owner: BlobOwner) =>
  new TextEncoder().encode(`uniffy-upload-v1|${owner.userId}|${owner.organizationId}|${owner.id}`);

let dbPromise: Promise<IDBPDatabase | null> | null = null;

async function getDb(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (dbPromise) return dbPromise;
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    blocking() {
      void closeUploadDatabase();
    },
    upgrade(db) {
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        db.createObjectStore(RECORDS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, { keyPath: "key" });
        store.createIndex("uploadId", "uploadId", { unique: false });
      }
    },
  }).catch((err) => {
    // Private browsing / disabled storage. Caller treats `null` as no persistence.
    console.warn("[uploads] IndexedDB unavailable for upload store", err);
    return null;
  });
  return dbPromise;
}

export async function putRecord(record: UploadRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.put(RECORDS_STORE, record);
  } catch (err) {
    console.warn("[uploads] IndexedDB put record failed", err);
  }
}

export async function getRecord(id: string): Promise<UploadRecord | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    return await db.get(RECORDS_STORE, id);
  } catch (err) {
    console.warn("[uploads] IndexedDB get record failed", err);
    return undefined;
  }
}

// File bytes rest only encrypted; false (no key, db unavailable or quota) means no resume.
export async function putBlob(owner: BlobOwner, blob: Blob): Promise<boolean> {
  if (!owner.userId || !isStorageEncryptionReady()) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const plaintext = new Uint8Array(await blob.arrayBuffer());
    const data = await encryptBytesForStorage(plaintext, blobAdditionalData(owner));
    const row: BlobRow = {
      id: owner.id,
      userId: owner.userId,
      organizationId: owner.organizationId,
      data,
      type: blob.type,
    };
    await db.put(BLOBS_STORE, row);
    return true;
  } catch (err) {
    console.warn("[uploads] IndexedDB put blob failed", err);
    return false;
  }
}

// A row that fails authentication (another scope, a rotated key, no ciphertext) reads as missing.
export async function getBlob(owner: BlobOwner): Promise<Blob | undefined> {
  if (!owner.userId || !isStorageEncryptionReady()) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  try {
    const row: Partial<BlobRow> | undefined = await db.get(BLOBS_STORE, owner.id);
    if (!(row?.data instanceof ArrayBuffer)) return undefined;
    const bytes = await decryptBytesFromStorage(row.data, blobAdditionalData(owner));
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: row.type ?? "" });
  } catch (err) {
    console.warn("[uploads] IndexedDB get blob failed", err);
    return undefined;
  }
}

export async function deleteRecords(ids: Iterable<string>): Promise<void> {
  const targets = Array.from(ids);
  if (targets.length === 0) return;
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction([RECORDS_STORE, BLOBS_STORE], "readwrite");
    await Promise.all([
      ...targets.flatMap((id) => [
        tx.objectStore(RECORDS_STORE).delete(id),
        tx.objectStore(BLOBS_STORE).delete(id),
      ]),
      tx.done,
    ]);
  } catch (err) {
    console.warn("[uploads] IndexedDB delete failed", err);
  }
}

export async function listIncompleteFor(scope: UploadScope): Promise<UploadRecord[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const records: UploadRecord[] = await db.getAll(RECORDS_STORE);
    return records.filter(
      (record) => !TERMINAL_STATUSES.has(record.status) && sameUploadScope(record, scope),
    );
  } catch (err) {
    console.warn("[uploads] IndexedDB list failed", err);
    return [];
  }
}

/** Deletes every record, blob and recording chunk whose owner stamp `match` accepts. */
export async function deleteRowsMatching(match: (owner: StoredRowOwner) => boolean): Promise<void> {
  await Promise.all(chunkWrites.values());
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction([RECORDS_STORE, BLOBS_STORE, CHUNKS_STORE], "readwrite");
    const sweeps = [RECORDS_STORE, BLOBS_STORE, CHUNKS_STORE].map(async (name) => {
      let cursor = await tx.objectStore(name).openCursor();
      while (cursor) {
        const row = cursor.value as StoredRowOwner;
        if (match({ userId: row.userId, organizationId: row.organizationId })) {
          await cursor.delete();
        }
        cursor = await cursor.continue();
      }
    });
    await Promise.all([...sweeps, tx.done]);
  } catch (err) {
    console.warn("[uploads] IndexedDB purge failed", err);
  }
}

interface ChunkRow extends StoredRowOwner {
  key: string;
  uploadId: string;
  partNumber: number;
  data: ArrayBuffer;
  type: string;
  size: number;
  createdAt: number;
}

export interface PersistedChunk {
  uploadId: string;
  partNumber: number;
  blob: Blob;
  size: number;
  createdAt: number;
}

// Keyed so lexical order matches numeric part order.
function chunkKey(uploadId: string, partNumber: number): string {
  return `${uploadId}:${partNumber.toString().padStart(8, "0")}`;
}

const chunkAdditionalData = (scope: UploadScope, uploadId: string, partNumber: number) =>
  new TextEncoder().encode(
    `uniffy-recording-v1|${scope.userId}|${scope.organizationId}|${uploadId}|${partNumber}`,
  );

// Encryption must finish in write order, including deletion after upload or cancellation.
const chunkWrites = new Map<string, Promise<void>>();

async function closeUploadDatabase(): Promise<void> {
  await Promise.all(chunkWrites.values());
  (await dbPromise)?.close();
  dbPromise = null;
}

registerEncryptedDatabase(DB_NAME, closeUploadDatabase);

function serializeChunkWrite<T>(uploadId: string, write: () => Promise<T>): Promise<T> {
  const result = (chunkWrites.get(uploadId) ?? Promise.resolve()).then(write);
  const settled = result.then(
    () => {},
    () => {},
  );
  chunkWrites.set(uploadId, settled);
  void settled.then(() => {
    if (chunkWrites.get(uploadId) === settled) chunkWrites.delete(uploadId);
  });
  return result;
}

// The recording uploader writes while its tab holds one scope, so the tab's scope owns the part.
export async function putChunk(
  uploadId: string,
  partNumber: number,
  blob: Blob,
  scope: UploadScope | null = getUploadScope(),
): Promise<boolean> {
  if (!scope || !isStorageEncryptionReady()) return false;
  const createdAt = Date.now();
  return serializeChunkWrite(uploadId, async () => {
    const db = await getDb();
    if (!db || !isStorageEncryptionReady()) return false;
    try {
      const data = await encryptBytesForStorage(
        new Uint8Array(await blob.arrayBuffer()),
        chunkAdditionalData(scope, uploadId, partNumber),
      );
      const row: ChunkRow = {
        key: chunkKey(uploadId, partNumber),
        uploadId,
        userId: scope.userId,
        organizationId: scope.organizationId,
        partNumber,
        data,
        type: blob.type,
        size: blob.size,
        createdAt,
      };
      await db.put(CHUNKS_STORE, row);
      return true;
    } catch (err) {
      console.warn("[uploads] IndexedDB put chunk failed", err);
      return false;
    }
  });
}

export async function deleteChunk(uploadId: string, partNumber: number): Promise<void> {
  return serializeChunkWrite(uploadId, async () => {
    const db = await getDb();
    if (!db) return;
    try {
      await db.delete(CHUNKS_STORE, chunkKey(uploadId, partNumber));
    } catch (err) {
      console.warn("[uploads] IndexedDB delete chunk failed", err);
    }
  });
}

export async function clearUploadChunks(uploadId: string): Promise<void> {
  return serializeChunkWrite(uploadId, async () => {
    const db = await getDb();
    if (!db) return;
    try {
      const tx = db.transaction(CHUNKS_STORE, "readwrite");
      const index = tx.store.index("uploadId");
      let cursor = await index.openCursor(uploadId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    } catch (err) {
      console.warn("[uploads] IndexedDB clear chunks failed", err);
    }
  });
}

export async function loadPendingChunks(
  uploadId: string,
  scope: UploadScope | null = getUploadScope(),
): Promise<PersistedChunk[]> {
  if (!scope || !isStorageEncryptionReady()) throw new Error("Recording storage is not ready");
  await chunkWrites.get(uploadId);
  const db = await getDb();
  if (!db) throw new Error("Recording storage is unavailable");
  const rows: ChunkRow[] = await db.getAllFromIndex(CHUNKS_STORE, "uploadId", uploadId);
  const chunks: PersistedChunk[] = [];
  for (const row of rows) {
    if (!sameUploadScope(row, scope) || !(row.data instanceof ArrayBuffer)) {
      throw new Error("Recording chunk cannot be authenticated");
    }
    const bytes = await decryptBytesFromStorage(
      row.data,
      chunkAdditionalData(scope, uploadId, row.partNumber),
    );
    chunks.push({
      uploadId: row.uploadId,
      partNumber: row.partNumber,
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: row.type }),
      size: bytes.byteLength,
      createdAt: row.createdAt,
    });
  }
  return chunks.sort((a, b) => a.partNumber - b.partNumber);
}

export async function listOrphanedChunkUploads(
  olderThanMs: number,
  scope: UploadScope,
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const cutoff = Date.now() - olderThanMs;
    const all: ChunkRow[] = await db.getAll(CHUNKS_STORE);
    const ids = new Set<string>();
    for (const row of all) {
      if (row.createdAt <= cutoff && sameUploadScope(row, scope)) {
        ids.add(row.uploadId);
      }
    }
    return Array.from(ids);
  } catch (err) {
    console.warn("[uploads] IndexedDB list orphaned chunks failed", err);
    return [];
  }
}
