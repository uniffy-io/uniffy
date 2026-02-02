/**
 * File Store - In-memory storage for File objects
 *
 * File objects cannot be stored in Redux (non-serializable).
 * This module provides a simple in-memory store keyed by upload ID.
 */

// In-memory store for File objects
const fileStore = new Map<string, File>();

/**
 * Store a file by upload ID.
 */
export function storeFile(uploadId: string, file: File): void {
    fileStore.set(uploadId, file);
}

/**
 * Get a file by upload ID.
 */
export function getFile(uploadId: string): File | undefined {
    return fileStore.get(uploadId);
}

/**
 * Remove a file from the store.
 */
export function removeFile(uploadId: string): void {
    fileStore.delete(uploadId);
}

/**
 * Clear all stored files.
 */
export function clearFiles(): void {
    fileStore.clear();
}
