/**
 * Files API Service
 *
 * Centralized ConnectRPC client for files operations.
 * Handles streaming uploads/downloads through the backend.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { FilesService } from '@uniffy/proto/files/v1/files_connect';
import type {
    InitiateUploadRequest,
    GetUploadStatusRequest,
    AbortUploadRequest,
    GetFileRequest,
    UpdateFileRequest,
    DeleteFileRequest,
    RestoreFileRequest,
    ListFilesRequest,
    CreateFolderRequest,
    UpdateFolderRequest,
    DeleteFolderRequest,
    GetFilesTreeRequest,
    EmptyTrashRequest,
    ListTrashRequest,
    RestoreFolderRequest,
    ListFileVersionsRequest,
    UploadChunkRequest,
    CompleteUploadRequest,
    MoveItemsRequest,
    CreateFolderTreeRequest,
    CheckStorageQuotaRequest,
} from '@uniffy/proto/files/v1/files_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

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
    initiateUpload: async (request: PartialMessage<InitiateUploadRequest>) => {
        return filesClient.initiateUpload(request);
    },

    /**
     * Upload a single chunk (browser-compatible unary RPC).
     * Call this for each chunk, then call completeUpload when done.
     */
    uploadChunk: async (request: PartialMessage<UploadChunkRequest>) => {
        return filesClient.uploadChunk(request);
    },

    /**
     * Complete an upload after all chunks have been sent.
     * Returns the completed file.
     */
    completeUpload: async (request: PartialMessage<CompleteUploadRequest>) => {
        return filesClient.completeUpload(request);
    },

    /**
     * Get status of an in-progress upload (for resumable uploads).
     */
    getUploadStatus: async (request: PartialMessage<GetUploadStatusRequest>) => {
        return filesClient.getUploadStatus(request);
    },

    /**
     * Abort an in-progress upload.
     */
    abortUpload: async (request: PartialMessage<AbortUploadRequest>) => {
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
    getFile: async (request: PartialMessage<GetFileRequest>) => {
        return filesClient.getFile(request);
    },

    /**
     * Update file metadata (rename, tags, description).
     */
    updateFile: async (request: PartialMessage<UpdateFileRequest>) => {
        return filesClient.updateFile(request);
    },

    /**
     * Delete a file (soft delete by default).
     */
    deleteFile: async (request: PartialMessage<DeleteFileRequest>) => {
        return filesClient.deleteFile(request);
    },

    /**
     * Restore a soft-deleted file.
     */
    restoreFile: async (request: PartialMessage<RestoreFileRequest>) => {
        return filesClient.restoreFile(request);
    },

    /**
     * List files with filters and pagination.
     */
    listFiles: async (request: PartialMessage<ListFilesRequest>) => {
        return filesClient.listFiles(request);
    },

    // ─────────────────────────────────────────────────────────────
    // Folder operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Create a new folder.
     */
    createFolder: async (request: PartialMessage<CreateFolderRequest>) => {
        return filesClient.createFolder(request);
    },

    /**
     * Update a folder.
     */
    updateFolder: async (request: PartialMessage<UpdateFolderRequest>) => {
        return filesClient.updateFolder(request);
    },

    /**
     * Delete a folder.
     */
    deleteFolder: async (request: PartialMessage<DeleteFolderRequest>) => {
        return filesClient.deleteFolder(request);
    },

    /**
     * Get the files tree structure.
     */
    getFilesTree: async (request: PartialMessage<GetFilesTreeRequest>) => {
        return filesClient.getFilesTree(request);
    },

    // ─────────────────────────────────────────────────────────────
    // Bulk operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Empty trash (permanently delete all soft-deleted files).
     */
    emptyTrash: async (request: PartialMessage<EmptyTrashRequest>) => {
        return filesClient.emptyTrash(request);
    },

    /**
     * List deleted files and folders in trash.
     */
    listTrash: async (request: PartialMessage<ListTrashRequest>) => {
        return filesClient.listTrash(request);
    },

    /**
     * Restore a soft-deleted folder (and its soft-deleted contents).
     */
    restoreFolder: async (request: PartialMessage<RestoreFolderRequest>) => {
        return filesClient.restoreFolder(request);
    },

    /**
     * List version history for a file.
     */
    listFileVersions: async (request: PartialMessage<ListFileVersionsRequest>) => {
        return filesClient.listFileVersions(request);
    },

    /**
     * Move files and folders to a different location and/or visibility scope.
     */
    moveItems: async (request: PartialMessage<MoveItemsRequest>) => {
        return filesClient.moveItems(request);
    },

    /**
     * Create a folder tree in a single transaction (for recursive folder upload).
     */
    createFolderTree: async (request: PartialMessage<CreateFolderTreeRequest>) => {
        return filesClient.createFolderTree(request);
    },

    /**
     * Pre-check whether an upload of a given size is allowed under quota.
     */
    checkStorageQuota: async (request: PartialMessage<CheckStorageQuotaRequest>) => {
        return filesClient.checkStorageQuota(request);
    },
};
