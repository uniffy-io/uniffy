/** LRU blob URL cache; freed URLs are revoked to avoid leaking object URLs. */

interface CacheEntry {
    url: string;
    blob: Blob;
    mimeType: string;
    filename: string;
    size: number;
    lastAccessed: number;
}

const MAX_CACHE_SIZE = 20;
const MAX_CACHE_BYTES = 100 * 1024 * 1024;

const cache = new Map<string, CacheEntry>();

let totalCachedBytes = 0;

function getCacheKey(fileId: string, versionId?: string): string {
    return versionId ? `${fileId}:${versionId}` : fileId;
}

export function getCachedBlob(fileId: string, versionId?: string): CacheEntry | null {
    const key = getCacheKey(fileId, versionId);
    const entry = cache.get(key);

    if (entry) {
        entry.lastAccessed = Date.now();
        return entry;
    }

    return null;
}

export function setCachedBlob(
    fileId: string,
    blob: Blob,
    url: string,
    mimeType: string,
    filename: string,
    versionId?: string
): void {
    const key = getCacheKey(fileId, versionId);
    const size = blob.size;

    if (cache.has(key)) {
        const existing = cache.get(key)!;
        totalCachedBytes -= existing.size;
        URL.revokeObjectURL(existing.url);
        cache.delete(key);
    }

    evictIfNeeded(size);

    cache.set(key, {
        url,
        blob,
        mimeType,
        filename,
        size,
        lastAccessed: Date.now(),
    });
    totalCachedBytes += size;
}

function evictIfNeeded(newEntrySize: number): void {
    while (cache.size >= MAX_CACHE_SIZE) {
        evictLRU();
    }

    while (totalCachedBytes + newEntrySize > MAX_CACHE_BYTES && cache.size > 0) {
        evictLRU();
    }
}

function evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of cache.entries()) {
        if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed;
            oldestKey = key;
        }
    }

    if (oldestKey) {
        const entry = cache.get(oldestKey)!;
        URL.revokeObjectURL(entry.url);
        totalCachedBytes -= entry.size;
        cache.delete(oldestKey);
    }
}

export function removeCachedBlob(fileId: string, versionId?: string): void {
    const key = getCacheKey(fileId, versionId);
    const entry = cache.get(key);

    if (entry) {
        URL.revokeObjectURL(entry.url);
        totalCachedBytes -= entry.size;
        cache.delete(key);
    }
}

/** Call on logout or when switching organizations. */
export function clearBlobCache(): void {
    for (const entry of cache.values()) {
        URL.revokeObjectURL(entry.url);
    }
    cache.clear();
    totalCachedBytes = 0;
}

export function getCacheStats(): { count: number; totalBytes: number; maxCount: number; maxBytes: number } {
    return {
        count: cache.size,
        totalBytes: totalCachedBytes,
        maxCount: MAX_CACHE_SIZE,
        maxBytes: MAX_CACHE_BYTES,
    };
}
