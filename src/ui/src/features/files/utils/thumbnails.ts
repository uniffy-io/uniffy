/**
 * Client-side thumbnail generation utilities.
 *
 * Generates thumbnails for images using Canvas API and caches them in IndexedDB.
 */

import { openDB, type IDBPDatabase } from 'idb';

const THUMB_SIZE = 200;
const DB_NAME = 'uniffy-thumbnails';
const DB_VERSION = 1;
const STORE_NAME = 'thumbnails';

interface ThumbnailDB {
    thumbnails: {
        key: string;
        value: string;
    };
}

let dbPromise: Promise<IDBPDatabase<ThumbnailDB>> | null = null;

/**
 * Get or create the IndexedDB database for thumbnails.
 */
function getDB(): Promise<IDBPDatabase<ThumbnailDB>> {
    if (!dbPromise) {
        dbPromise = openDB<ThumbnailDB>(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            },
        });
    }
    return dbPromise;
}

/**
 * Get a cached thumbnail from IndexedDB.
 */
async function getThumbnailFromCache(fileId: string): Promise<string | null> {
    try {
        const db = await getDB();
        const result = await db.get(STORE_NAME, fileId);
        return result || null;
    } catch {
        return null;
    }
}

/**
 * Save a thumbnail to IndexedDB cache.
 */
async function saveThumbnailToCache(fileId: string, dataUrl: string): Promise<void> {
    try {
        const db = await getDB();
        await db.put(STORE_NAME, dataUrl, fileId);
    } catch {
        // Silently fail - caching is optional
    }
}

/**
 * Generate a thumbnail from an image URL.
 *
 * @param imageUrl - The URL of the full-size image
 * @param fileId - The file ID for caching
 * @returns A data URL of the thumbnail image
 */
export async function generateImageThumbnail(
    imageUrl: string,
    fileId: string
): Promise<string> {
    // Check cache first
    const cached = await getThumbnailFromCache(fileId);
    if (cached) return cached;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = async () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                // Calculate dimensions maintaining aspect ratio
                const ratio = Math.min(THUMB_SIZE / img.width, THUMB_SIZE / img.height);
                canvas.width = Math.round(img.width * ratio);
                canvas.height = Math.round(img.height * ratio);

                // Draw scaled image
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Convert to data URL
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                // Cache it
                await saveThumbnailToCache(fileId, dataUrl);

                resolve(dataUrl);
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };

        img.src = imageUrl;
    });
}

/**
 * Clear all cached thumbnails.
 */
export async function clearThumbnailCache(): Promise<void> {
    try {
        const db = await getDB();
        await db.clear(STORE_NAME);
    } catch {
        // Silently fail
    }
}

/**
 * Remove a specific thumbnail from cache.
 */
export async function removeThumbnailFromCache(fileId: string): Promise<void> {
    try {
        const db = await getDB();
        await db.delete(STORE_NAME, fileId);
    } catch {
        // Silently fail
    }
}
