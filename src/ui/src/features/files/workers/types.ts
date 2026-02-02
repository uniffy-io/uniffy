/**
 * File Worker Message Types
 *
 * Type definitions for communication between main thread and file workers.
 * Workers handle CPU-intensive operations like file chunking and ZIP compression.
 */

// ─────────────────────────────────────────────────────────────
// Upload Operations
// ─────────────────────────────────────────────────────────────

/**
 * Request to upload file chunks in the worker.
 * Worker handles the entire slice + upload loop.
 */
export interface UploadChunksRequest {
    type: 'UPLOAD_CHUNKS';
    /** Correlation ID for this operation */
    id: string;
    /** File to upload (structured clone) */
    file: File;
    /** Upload session ID from initiateUpload */
    uploadId: string;
    /** Size of each chunk in bytes */
    chunkSize: number;
    /** Total number of chunks */
    totalChunks: number;
    /** Current access token for Authorization header */
    token: string;
    /** API base URL */
    apiUrl: string;
}

/**
 * Progress update from worker during upload.
 */
export interface UploadProgress {
    type: 'UPLOAD_PROGRESS';
    id: string;
    uploadedChunks: number;
    uploadedBytes: number;
}

/**
 * Worker needs a fresh auth token (got 401).
 */
export interface TokenNeeded {
    type: 'TOKEN_NEEDED';
    id: string;
}

/**
 * Main thread provides refreshed token.
 */
export interface TokenRefresh {
    type: 'TOKEN_REFRESH';
    id: string;
    token: string;
}

/**
 * Upload completed successfully.
 */
export interface UploadComplete {
    type: 'UPLOAD_COMPLETE';
    id: string;
}

// ─────────────────────────────────────────────────────────────
// Archive/Compression Operations
// ─────────────────────────────────────────────────────────────

/**
 * File data for ZIP compression.
 */
export interface ZipFileEntry {
    /** Path in archive (e.g., "folder/file.txt") */
    path: string;
    /** File content as ArrayBuffer */
    data: ArrayBuffer;
    /** MIME type of the file */
    mimeType: string;
}

/**
 * Request to compress files into a ZIP archive.
 */
export interface CompressZipRequest {
    type: 'COMPRESS_ZIP';
    id: string;
    files: ZipFileEntry[];
    /** Compression level 1-9 (6 is good balance) */
    compressionLevel: number;
}

/**
 * Progress update during ZIP compression.
 */
export interface CompressZipProgress {
    type: 'COMPRESS_ZIP_PROGRESS';
    id: string;
    fileIndex: number;
    totalFiles: number;
}

/**
 * ZIP compression completed.
 */
export interface CompressZipResult {
    type: 'COMPRESS_ZIP_RESULT';
    id: string;
    /** Compressed ZIP data as ArrayBuffer (transferable) */
    zipData: ArrayBuffer;
}

// ─────────────────────────────────────────────────────────────
// Chunk Operations (for downloads)
// ─────────────────────────────────────────────────────────────

/**
 * Request to concatenate chunks into single buffer.
 */
export interface ConcatChunksRequest {
    type: 'CONCAT_CHUNKS';
    id: string;
    chunks: ArrayBuffer[];
    mimeType: string;
}

/**
 * Chunk concatenation result.
 */
export interface ConcatChunksResult {
    type: 'CONCAT_CHUNKS_RESULT';
    id: string;
    data: ArrayBuffer;
}

// ─────────────────────────────────────────────────────────────
// Control Messages
// ─────────────────────────────────────────────────────────────

/**
 * Abort an in-progress operation.
 */
export interface AbortRequest {
    type: 'ABORT';
    id: string;
}

/**
 * Error response from worker.
 */
export interface WorkerError {
    type: 'ERROR';
    id: string;
    error: string;
}

// ─────────────────────────────────────────────────────────────
// Union Types
// ─────────────────────────────────────────────────────────────

/** Messages sent from main thread to worker */
export type WorkerRequest =
    | UploadChunksRequest
    | CompressZipRequest
    | ConcatChunksRequest
    | TokenRefresh
    | AbortRequest;

/** Messages sent from worker to main thread */
export type WorkerResponse =
    | UploadProgress
    | UploadComplete
    | TokenNeeded
    | CompressZipProgress
    | CompressZipResult
    | ConcatChunksResult
    | WorkerError;
