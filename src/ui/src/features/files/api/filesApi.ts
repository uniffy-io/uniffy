/**
 * Files API Service
 *
 * Centralized ConnectRPC client for files operations.
 * Handles streaming uploads/downloads through the backend.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    FilesService,
    InitiateUploadRequestSchema,
    GetUploadStatusRequestSchema,
    AbortUploadRequestSchema,
    GetFileRequestSchema,
    UpdateFileRequestSchema,
    DeleteFileRequestSchema,
    RestoreFileRequestSchema,
    ListFilesRequestSchema,
    CreateFolderRequestSchema,
    UpdateFolderRequestSchema,
    DeleteFolderRequestSchema,
    GetFilesTreeRequestSchema,
    EmptyTrashRequestSchema,
    ListTrashRequestSchema,
    RestoreFolderRequestSchema,
    ListFileVersionsRequestSchema,
    UploadChunkRequestSchema,
    CompleteUploadRequestSchema,
    MoveItemsRequestSchema,
    CreateFolderTreeRequestSchema,
    CheckStorageQuotaRequestSchema,
    EnsureRecordingsFolderRequestSchema,
} from '@uniffy/proto/files/v1/files_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a files service client with the shared transport.
 */
const filesClient = createClient(FilesService, transport);

/**
 * Files API service with typed methods.
 */
export const filesApi = {
    // ─────────────────────────────────────────────────────────────
    // Upload operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Initialize a new upload session.
     * Returns upload_id and chunk parameters for streaming.
     */
    initiateUpload: async (request: MessageInitShape<typeof InitiateUploadRequestSchema>) => {
        return filesClient.initiateUpload(request);
    },

    /**
     * Upload a single chunk (browser-compatible unary RPC).
     * Call this for each chunk, then call completeUpload when done.
     */
    uploadChunk: async (request: MessageInitShape<typeof UploadChunkRequestSchema>) => {
        return filesClient.uploadChunk(request);
    },

    /**
     * Complete an upload after all chunks have been sent.
     * Returns the completed file.
     */
    completeUpload: async (request: MessageInitShape<typeof CompleteUploadRequestSchema>) => {
        return filesClient.completeUpload(request);
    },

    /**
     * Get status of an in-progress upload (for resumable uploads).
     */
    getUploadStatus: async (request: MessageInitShape<typeof GetUploadStatusRequestSchema>) => {
        return filesClient.getUploadStatus(request);
    },

    /**
     * Abort an in-progress upload.
     */
    abortUpload: async (request: MessageInitShape<typeof AbortUploadRequestSchema>) => {
        return filesClient.abortUpload(request);
    },

    // ─────────────────────────────────────────────────────────────
    // Download operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Stream file content from backend.
     * This is a server streaming RPC - returns an async iterable of chunks.
     */
    downloadFile: (request: { fileId: string; organizationId: string; versionId?: string }) => {
        return filesClient.downloadFile(request);
    },

    // ─────────────────────────────────────────────────────────────
    // File CRUD operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Get a file by ID.
     */
    getFile: async (request: MessageInitShape<typeof GetFileRequestSchema>) => {
        return filesClient.getFile(request);
    },

    /**
     * Update file metadata (rename, tags, description).
     */
    updateFile: async (request: MessageInitShape<typeof UpdateFileRequestSchema>) => {
        return filesClient.updateFile(request);
    },

    /**
     * Delete a file (soft delete by default).
     */
    deleteFile: async (request: MessageInitShape<typeof DeleteFileRequestSchema>) => {
        return filesClient.deleteFile(request);
    },

    /**
     * Restore a soft-deleted file.
     */
    restoreFile: async (request: MessageInitShape<typeof RestoreFileRequestSchema>) => {
        return filesClient.restoreFile(request);
    },

    /**
     * List files with filters and pagination.
     */
    listFiles: async (request: MessageInitShape<typeof ListFilesRequestSchema>) => {
        return filesClient.listFiles(request);
    },

    // ─────────────────────────────────────────────────────────────
    // Folder operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Create a new folder.
     */
    createFolder: async (request: MessageInitShape<typeof CreateFolderRequestSchema>) => {
        return filesClient.createFolder(request);
    },

    /**
     * Update a folder.
     */
    updateFolder: async (request: MessageInitShape<typeof UpdateFolderRequestSchema>) => {
        return filesClient.updateFolder(request);
    },

    /**
     * Delete a folder.
     */
    deleteFolder: async (request: MessageInitShape<typeof DeleteFolderRequestSchema>) => {
        return filesClient.deleteFolder(request);
    },

    /**
     * Get the files tree structure.
     */
    getFilesTree: async (request: MessageInitShape<typeof GetFilesTreeRequestSchema>) => {
        return filesClient.getFilesTree(request);
    },

    // ─────────────────────────────────────────────────────────────
    // Bulk operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Empty trash (permanently delete all soft-deleted files).
     */
    emptyTrash: async (request: MessageInitShape<typeof EmptyTrashRequestSchema>) => {
        return filesClient.emptyTrash(request);
    },

    /**
     * List deleted files and folders in trash.
     */
    listTrash: async (request: MessageInitShape<typeof ListTrashRequestSchema>) => {
        return filesClient.listTrash(request);
    },

    /**
     * Restore a soft-deleted folder (and its soft-deleted contents).
     */
    restoreFolder: async (request: MessageInitShape<typeof RestoreFolderRequestSchema>) => {
        return filesClient.restoreFolder(request);
    },

    /**
     * List version history for a file.
     */
    listFileVersions: async (request: MessageInitShape<typeof ListFileVersionsRequestSchema>) => {
        return filesClient.listFileVersions(request);
    },

    /**
     * Move files and folders to a different location and/or visibility scope.
     */
    moveItems: async (request: MessageInitShape<typeof MoveItemsRequestSchema>) => {
        return filesClient.moveItems(request);
    },

    /**
     * Create a folder tree in a single transaction (for recursive folder upload).
     */
    createFolderTree: async (request: MessageInitShape<typeof CreateFolderTreeRequestSchema>) => {
        return filesClient.createFolderTree(request);
    },

    /**
     * Lazily create or fetch the per-user "Recordings" system folder.
     * Idempotent under concurrent calls.
     */
    ensureRecordingsFolder: async (request: MessageInitShape<typeof EnsureRecordingsFolderRequestSchema>) => {
        return filesClient.ensureRecordingsFolder(request);
    },

    /**
     * Pre-check whether an upload of a given size is allowed under quota.
     */
    checkStorageQuota: async (request: MessageInitShape<typeof CheckStorageQuotaRequestSchema>) => {
        return filesClient.checkStorageQuota(request);
    },
};
