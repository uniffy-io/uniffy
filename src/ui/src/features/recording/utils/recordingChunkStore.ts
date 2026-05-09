/**
 * IndexedDB-backed write-through queue for in-flight upload chunks.
 *
 * Why: a `MediaRecorder` chunk is in memory until the upload acks. If the
 * tab crashes / the user accidentally closes it during recording, every
 * unacked chunk is lost. Persisting each part to IndexedDB before sending,
 * and dropping the row on the upload ack, lets a future session reload
 * the orphaned bytes against the same `MultipartUpload` row (which lives
 * for 24h on the server).
 *
 * Storage layout: one IDB database (`uniffy-recording`), one object store
 * (`chunks`) keyed by `${uploadId}:${partNumber.toString().padStart(8,'0')}`.
 * Padded part number sorts lexically same as numerically.
 *
 * Failure modes:
 * - Quota exceeded: caller falls back to in-memory mode (logged warning).
 *   The recording continues; tab-crash recovery for that session is lost
 *   but the recording itself does not.
 * - DB open fails (private mode quirks): same fallback.
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
        // Private browsing / disabled storage / transient open failure.
        // Caller treats `null` as "no persistence available" and the
        // recording falls back to in-memory chunk handling.
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
