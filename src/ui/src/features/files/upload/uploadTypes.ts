import type { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import type { File as ProtoFile } from "@uniffy/proto/files/v1/files_pb";

/** Which surface enqueued the upload. Drives tray visibility (chat is shown inline, not in the tray). */
export type UploadContext = "files" | "chat" | "recording" | "editor";

export type UploadStatus =
  | "queued"
  | "uploading"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadInput {
  file: Blob;
  filename: string;
  mimeType: string;
  organizationId: string;
  context: UploadContext;
  folderId?: string;
  accessMode?: AccessMode;
  /** Override the size-based blob-persistence default. */
  persist?: boolean;
}

/** Serializable projection of one upload. Safe to mirror into Redux and render. */
export interface UploadRecord {
  id: string;
  filename: string;
  mimeType: string;
  context: UploadContext;
  organizationId: string;
  folderId?: string;
  accessMode?: AccessMode;
  totalSize: number;
  uploadedBytes: number;
  /** 0..100 */
  progress: number;
  status: UploadStatus;
  fileId?: string;
  error?: string;
  createdAt: number;

  uploadId?: string;
  chunkSize?: number;
  totalChunks?: number;
}

export interface UploadResult {
  fileId: string;
  file: ProtoFile;
}

export interface UploadHandle {
  id: string;
  /** Resolves once the file row exists; rejects on failure or cancel. */
  done: Promise<UploadResult>;
}

export type UploadListener = (records: ReadonlyArray<UploadRecord>) => void;
