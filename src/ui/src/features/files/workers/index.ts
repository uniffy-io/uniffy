/**
 * File Workers
 *
 * Web Worker infrastructure for CPU-intensive file operations.
 * Moves file chunking, uploading, and ZIP compression off the main thread.
 */

export { fileWorkerManager, FileWorkerManager } from './FileWorkerManager';
export type { ZipFileEntry } from './types';
