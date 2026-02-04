/**
 * File Workers
 *
 * Web Worker infrastructure for CPU-intensive file operations.
 * Moves file chunking, uploading, and ZIP compression off the main thread.
 */

export { fileWorkerManager, FileWorkerManager } from '@/features/files/workers/FileWorkerManager';
export type { ZipFileEntry } from '@/features/files/workers/types';
