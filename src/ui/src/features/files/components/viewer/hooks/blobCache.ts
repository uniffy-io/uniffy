/**
 * Blob URL Cache for File Viewer
 *
 * Caches blob URLs to avoid re-downloading files when navigating
 * between files in the viewer. Uses LRU (Least Recently Used) eviction
 * to prevent memory leaks.
 */

interface CacheEntry {
    url: string;
    blob: Blob;
    mimeType: string;
    filename: string;
    size: number;
    lastAccessed: number;
}

// Maximum number of cached files (adjust based on expected file sizes)
const MAX_CACHE_SIZE = 20;

// Maximum total cache size in bytes (100MB)
const MAX_CACHE_BYTES = 100 * 1024 * 1024;

// Cache storage
const cache = new Map<string, CacheEntry>();

// Track total cached bytes
let totalCachedBytes = 0;

/**
 * Generate cache key from file ID and optional version ID.
 */
function getCacheKey(fileId: string, versionId?: string): string {
    return versionId ? `${fileId}:${versionId}` : fileId;
}

/**
 * Get a cached blob URL for a file.
 * Returns null if not cached.
 */
export function getCachedBlob(fileId: string, versionId?: string): CacheEntry | null {
    const key = getCacheKey(fileId, versionId);
    const entry = cache.get(key);

    if (entry) {
        // Update last accessed time (LRU tracking)
        entry.lastAccessed = Date.now();
        return entry;
    }

    return null;
}

/**
 * Cache a blob URL for a file.
 */
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

    // If this file is already cached, remove it first
    if (cache.has(key)) {
        const existing = cache.get(key)!;
        totalCachedBytes -= existing.size;
        URL.revokeObjectURL(existing.url);
        cache.delete(key);
    }

    // Evict entries if we're over the limits
    evictIfNeeded(size);

    // Store new entry
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

/**
 * Evict least recently used entries to make room for new entry.
 */
function evictIfNeeded(newEntrySize: number): void {
    // Check if we need to evict based on count
    while (cache.size >= MAX_CACHE_SIZE) {
        evictLRU();
    }

    // Check if we need to evict based on total size
    while (totalCachedBytes + newEntrySize > MAX_CACHE_BYTES && cache.size > 0) {
        evictLRU();
    }
}

/**
 * Evict the least recently used entry.
 */
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

/**
 * Remove a specific file from cache.
 */
export function removeCachedBlob(fileId: string, versionId?: string): void {
    const key = getCacheKey(fileId, versionId);
    const entry = cache.get(key);

    if (entry) {
        URL.revokeObjectURL(entry.url);
        totalCachedBytes -= entry.size;
        cache.delete(key);
    }
}

/**
 * Clear all cached blobs.
 * Call this on logout or when switching organizations.
 */
export function clearBlobCache(): void {
    for (const entry of cache.values()) {
        URL.revokeObjectURL(entry.url);
    }
    cache.clear();
    totalCachedBytes = 0;
}

/**
 * Get cache statistics for debugging.
 */
export function getCacheStats(): { count: number; totalBytes: number; maxCount: number; maxBytes: number } {
    return {
        count: cache.size,
        totalBytes: totalCachedBytes,
        maxCount: MAX_CACHE_SIZE,
        maxBytes: MAX_CACHE_BYTES,
    };
}
