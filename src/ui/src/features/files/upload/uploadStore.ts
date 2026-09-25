/**
 * IndexedDB persistence for the upload engine: whole-file metadata + blobs (files/chat/editor, so an
 * upload survives reload and navigation) plus the streaming part-buffer the recording uploader writes
 * through for tab-crash recovery. One database, three stores, so nothing keeps a private upload store.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { UploadRecord } from "@/features/files/upload/uploadTypes";

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

interface BlobRow {
  id: string;
  blob: Blob;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;

async function getDb(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (dbPromise) return dbPromise;
  dbPromise = openDB(DB_NAME, DB_VERSION, {
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

// Returns false (db unavailable or quota) so the caller can fall back to no-resume.
export async function putBlob(id: string, blob: Blob): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row: BlobRow = { id, blob };
  try {
    await db.put(BLOBS_STORE, row);
    return true;
  } catch (err) {
    console.warn("[uploads] IndexedDB put blob failed", err);
    return false;
  }
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const row: BlobRow | undefined = await db.get(BLOBS_STORE, id);
    return row?.blob;
  } catch (err) {
    console.warn("[uploads] IndexedDB get blob failed", err);
    return undefined;
  }
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction([RECORDS_STORE, BLOBS_STORE], "readwrite");
    await Promise.all([
      tx.objectStore(RECORDS_STORE).delete(id),
      tx.objectStore(BLOBS_STORE).delete(id),
      tx.done,
    ]);
  } catch (err) {
    console.warn("[uploads] IndexedDB delete failed", err);
  }
}

export async function listIncomplete(): Promise<UploadRecord[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const records: UploadRecord[] = await db.getAll(RECORDS_STORE);
    return records.filter((record) => !TERMINAL_STATUSES.has(record.status));
  } catch (err) {
    console.warn("[uploads] IndexedDB list failed", err);
    return [];
  }
}

export async function clearUploadRecords(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction([RECORDS_STORE, BLOBS_STORE], "readwrite");
    await Promise.all([
      tx.objectStore(RECORDS_STORE).clear(),
      tx.objectStore(BLOBS_STORE).clear(),
      tx.done,
    ]);
  } catch (err) {
    console.warn("[uploads] IndexedDB clear failed", err);
  }
}

interface ChunkRow {
  key: string;
  uploadId: string;
  partNumber: number;
  blob: Blob;
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

export async function putChunk(uploadId: string, partNumber: number, blob: Blob): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row: ChunkRow = {
    key: chunkKey(uploadId, partNumber),
    uploadId,
    partNumber,
    blob,
    size: blob.size,
    createdAt: Date.now(),
  };
  try {
    await db.put(CHUNKS_STORE, row);
    return true;
  } catch (err) {
    console.warn("[uploads] IndexedDB put chunk failed", err);
    return false;
  }
}

export async function deleteChunk(uploadId: string, partNumber: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(CHUNKS_STORE, chunkKey(uploadId, partNumber));
  } catch (err) {
    console.warn("[uploads] IndexedDB delete chunk failed", err);
  }
}

export async function clearUploadChunks(uploadId: string): Promise<void> {
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
}

export async function loadPendingChunks(uploadId: string): Promise<PersistedChunk[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows: ChunkRow[] = await db.getAllFromIndex(CHUNKS_STORE, "uploadId", uploadId);
    return rows
      .map((row) => ({
        uploadId: row.uploadId,
        partNumber: row.partNumber,
        blob: row.blob,
        size: row.size,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.partNumber - b.partNumber);
  } catch (err) {
    console.warn("[uploads] IndexedDB load chunks failed", err);
    return [];
  }
}

export async function listOrphanedChunkUploads(olderThanMs: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const cutoff = Date.now() - olderThanMs;
    const all: ChunkRow[] = await db.getAll(CHUNKS_STORE);
    const ids = new Set<string>();
    for (const row of all) {
      if (row.createdAt <= cutoff) {
        ids.add(row.uploadId);
      }
    }
    return Array.from(ids);
  } catch (err) {
    console.warn("[uploads] IndexedDB list orphaned chunks failed", err);
    return [];
  }
}
