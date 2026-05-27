/**
 * IndexedDB write-through queue for in-flight upload chunks. Keys are
 * `${uploadId}:${partNumber.toString().padStart(8,'0')}` so lexical order matches numeric. On quota
 * or private-mode failures, callers fall back to in-memory only; the recording itself never breaks.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'uniffy-recording';
const DB_VERSION = 1;
const STORE = 'chunks';

interface ChunkRow {
    key: string;
    uploadId: string;
    partNumber: number;
    blob: Blob;
    size: number;
    createdAt: number;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;

function makeKey(uploadId: string, partNumber: number): string {
    return `${uploadId}:${partNumber.toString().padStart(8, '0')}`;
}

async function getDb(): Promise<IDBPDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    if (dbPromise) return dbPromise;
    dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'key' });
                store.createIndex('uploadId', 'uploadId', { unique: false });
            }
        },
    }).catch((err) => {
        // Private browsing / disabled storage. Caller treats `null` as in-memory-only.
        console.warn('[recording] IndexedDB unavailable for chunk store', err);
        return null;
    });
    return dbPromise;
}

export async function putChunk(
    uploadId: string,
    partNumber: number,
    blob: Blob,
): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;
    const row: ChunkRow = {
        key: makeKey(uploadId, partNumber),
        uploadId,
        partNumber,
        blob,
        size: blob.size,
        createdAt: Date.now(),
    };
    try {
        await db.put(STORE, row);
        return true;
    } catch (err) {
        console.warn('[recording] IndexedDB put failed', err);
        return false;
    }
}

export async function deleteChunk(
    uploadId: string,
    partNumber: number,
): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
        await db.delete(STORE, makeKey(uploadId, partNumber));
    } catch (err) {
        console.warn('[recording] IndexedDB delete failed', err);
    }
}

export async function clearUpload(uploadId: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
        const tx = db.transaction(STORE, 'readwrite');
        const index = tx.store.index('uploadId');
        let cursor = await index.openCursor(uploadId);
        while (cursor) {
            await cursor.delete();
            cursor = await cursor.continue();
        }
        await tx.done;
    } catch (err) {
        console.warn('[recording] IndexedDB clear failed', err);
    }
}

export interface PersistedChunk {
    uploadId: string;
    partNumber: number;
    blob: Blob;
    size: number;
    createdAt: number;
}

export async function loadPendingChunks(
    uploadId: string,
): Promise<PersistedChunk[]> {
    const db = await getDb();
    if (!db) return [];
    try {
        const rows: ChunkRow[] = await db.getAllFromIndex(STORE, 'uploadId', uploadId);
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
        console.warn('[recording] IndexedDB load failed', err);
        return [];
    }
}

export async function listOrphanedUploads(
    olderThanMs: number,
): Promise<string[]> {
    const db = await getDb();
    if (!db) return [];
    try {
        const cutoff = Date.now() - olderThanMs;
        const all: ChunkRow[] = await db.getAll(STORE);
        const ids = new Set<string>();
        for (const row of all) {
            if (row.createdAt <= cutoff) {
                ids.add(row.uploadId);
            }
        }
        return Array.from(ids);
    } catch (err) {
        console.warn('[recording] IndexedDB list failed', err);
        return [];
    }
}
