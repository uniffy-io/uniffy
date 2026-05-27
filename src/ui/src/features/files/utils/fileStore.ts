/** In-memory store for File objects keyed by upload ID. File is non-serializable so it cannot live in Redux. */

const fileStore = new Map<string, File>();

export function storeFile(uploadId: string, file: File): void {
    fileStore.set(uploadId, file);
}

export function getFile(uploadId: string): File | undefined {
    return fileStore.get(uploadId);
}

export function removeFile(uploadId: string): void {
    fileStore.delete(uploadId);
}

export function clearFiles(): void {
    fileStore.clear();
}
