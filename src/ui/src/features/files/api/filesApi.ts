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
    RestoreFileVersionRequestSchema,
    GetOrgFileVersionPolicyRequestSchema,
    UpdateOrgFileVersionPolicyRequestSchema,
    UploadChunkRequestSchema,
    CompleteUploadRequestSchema,
    MoveItemsRequestSchema,
    CreateFolderTreeRequestSchema,
    CheckStorageQuotaRequestSchema,
    EnsureRecordingsFolderRequestSchema,
} from '@uniffy/proto/files/v1/files_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const filesClient = createClient(FilesService, transport);

export const filesApi = {
    initiateUpload: async (request: MessageInitShape<typeof InitiateUploadRequestSchema>) => {
        return filesClient.initiateUpload(request);
    },

    uploadChunk: async (request: MessageInitShape<typeof UploadChunkRequestSchema>) => {
        return filesClient.uploadChunk(request);
    },

    completeUpload: async (request: MessageInitShape<typeof CompleteUploadRequestSchema>) => {
        return filesClient.completeUpload(request);
    },

    getUploadStatus: async (request: MessageInitShape<typeof GetUploadStatusRequestSchema>) => {
        return filesClient.getUploadStatus(request);
    },

    abortUpload: async (request: MessageInitShape<typeof AbortUploadRequestSchema>) => {
        return filesClient.abortUpload(request);
    },

    /** Server-streaming RPC returning an async iterable of chunks. */
    downloadFile: (request: { fileId: string; organizationId: string; versionId?: string }) => {
        return filesClient.downloadFile(request);
    },

    getFile: async (request: MessageInitShape<typeof GetFileRequestSchema>) => {
        return filesClient.getFile(request);
    },

    updateFile: async (request: MessageInitShape<typeof UpdateFileRequestSchema>) => {
        return filesClient.updateFile(request);
    },

    deleteFile: async (request: MessageInitShape<typeof DeleteFileRequestSchema>) => {
        return filesClient.deleteFile(request);
    },

    restoreFile: async (request: MessageInitShape<typeof RestoreFileRequestSchema>) => {
        return filesClient.restoreFile(request);
    },

    listFiles: async (request: MessageInitShape<typeof ListFilesRequestSchema>) => {
        return filesClient.listFiles(request);
    },

    createFolder: async (request: MessageInitShape<typeof CreateFolderRequestSchema>) => {
        return filesClient.createFolder(request);
    },

    updateFolder: async (request: MessageInitShape<typeof UpdateFolderRequestSchema>) => {
        return filesClient.updateFolder(request);
    },

    deleteFolder: async (request: MessageInitShape<typeof DeleteFolderRequestSchema>) => {
        return filesClient.deleteFolder(request);
    },

    getFilesTree: async (request: MessageInitShape<typeof GetFilesTreeRequestSchema>) => {
        return filesClient.getFilesTree(request);
    },

    emptyTrash: async (request: MessageInitShape<typeof EmptyTrashRequestSchema>) => {
        return filesClient.emptyTrash(request);
    },

    listTrash: async (request: MessageInitShape<typeof ListTrashRequestSchema>) => {
        return filesClient.listTrash(request);
    },

    restoreFolder: async (request: MessageInitShape<typeof RestoreFolderRequestSchema>) => {
        return filesClient.restoreFolder(request);
    },

    listFileVersions: async (request: MessageInitShape<typeof ListFileVersionsRequestSchema>) => {
        return filesClient.listFileVersions(request);
    },

    restoreFileVersion: async (request: MessageInitShape<typeof RestoreFileVersionRequestSchema>) => {
        return filesClient.restoreFileVersion(request);
    },

    getOrgFileVersionPolicy: async (request: MessageInitShape<typeof GetOrgFileVersionPolicyRequestSchema>) => {
        return filesClient.getOrgFileVersionPolicy(request);
    },

    updateOrgFileVersionPolicy: async (request: MessageInitShape<typeof UpdateOrgFileVersionPolicyRequestSchema>) => {
        return filesClient.updateOrgFileVersionPolicy(request);
    },

    moveItems: async (request: MessageInitShape<typeof MoveItemsRequestSchema>) => {
        return filesClient.moveItems(request);
    },

    createFolderTree: async (request: MessageInitShape<typeof CreateFolderTreeRequestSchema>) => {
        return filesClient.createFolderTree(request);
    },

    /** Idempotent under concurrent calls. */
    ensureRecordingsFolder: async (request: MessageInitShape<typeof EnsureRecordingsFolderRequestSchema>) => {
        return filesClient.ensureRecordingsFolder(request);
    },

    checkStorageQuota: async (request: MessageInitShape<typeof CheckStorageQuotaRequestSchema>) => {
        return filesClient.checkStorageQuota(request);
    },
};
