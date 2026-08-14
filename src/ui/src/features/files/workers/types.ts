export interface UploadChunksRequest {
  type: "UPLOAD_CHUNKS";
  id: string;
  file: Blob;
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  token: string;
  apiUrl: string;
  /** Part numbers already stored server-side; skipped on a resumed upload. */
  completedChunks?: number[];
}

export interface UploadProgress {
  type: "UPLOAD_PROGRESS";
  id: string;
  uploadedChunks: number;
  uploadedBytes: number;
}

export interface TokenNeeded {
  type: "TOKEN_NEEDED";
  id: string;
}

export interface TokenRefresh {
  type: "TOKEN_REFRESH";
  id: string;
  token: string;
}

export interface UploadComplete {
  type: "UPLOAD_COMPLETE";
  id: string;
}

export interface ZipFileEntry {
  path: string;
  data: ArrayBuffer;
  mimeType: string;
}

export interface CompressZipRequest {
  type: "COMPRESS_ZIP";
  id: string;
  files: ZipFileEntry[];
  /** DEFLATE level 1-9; 6 is the default balance. */
  compressionLevel: number;
}

export interface CompressZipProgress {
  type: "COMPRESS_ZIP_PROGRESS";
  id: string;
  fileIndex: number;
  totalFiles: number;
}

export interface CompressZipResult {
  type: "COMPRESS_ZIP_RESULT";
  id: string;
  zipData: ArrayBuffer;
}

export interface ConcatChunksRequest {
  type: "CONCAT_CHUNKS";
  id: string;
  chunks: ArrayBuffer[];
  mimeType: string;
}

export interface ConcatChunksResult {
  type: "CONCAT_CHUNKS_RESULT";
  id: string;
  data: ArrayBuffer;
}

export interface AbortRequest {
  type: "ABORT";
  id: string;
}

export interface WorkerError {
  type: "ERROR";
  id: string;
  error: string;
}

export type WorkerRequest =
  | UploadChunksRequest
  | CompressZipRequest
  | ConcatChunksRequest
  | TokenRefresh
  | AbortRequest;

export type WorkerResponse =
  | UploadProgress
  | UploadComplete
  | TokenNeeded
  | CompressZipProgress
  | CompressZipResult
  | ConcatChunksResult
  | WorkerError;
