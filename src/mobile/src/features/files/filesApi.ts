import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  FilesService,
  BatchListAttachmentsRequestSchema,
  BulkDeleteRequestSchema,
  CompleteUploadRequestSchema,
  CopyItemsRequestSchema,
  CreateFolderRequestSchema,
  DeleteFileRequestSchema,
  DeleteFolderRequestSchema,
  EmptyTrashRequestSchema,
  GetAttachmentsFolderRequestSchema,
  GetFileRequestSchema,
  GetFilesTreeRequestSchema,
  GetStorageUsageRequestSchema,
  InitiateUploadRequestSchema,
  ListFileVersionsRequestSchema,
  ListFilesRequestSchema,
  ListTrashRequestSchema,
  MoveItemsRequestSchema,
  RestoreFileRequestSchema,
  RestoreFileVersionRequestSchema,
  RestoreFolderRequestSchema,
  UpdateFileRequestSchema,
  UpdateFolderRequestSchema,
  UploadChunkRequestSchema,
} from "@uniffy/proto/files/v1/files_pb";
import { transport } from "@core/api/transport";
import { SLOW_RPC_TIMEOUT_MS } from "@core/api/baseFetch";

const client = createClient(FilesService, transport);

export const filesApi = {
  listFiles: (request: MessageInitShape<typeof ListFilesRequestSchema>) =>
    client.listFiles(request),

  getFile: (request: MessageInitShape<typeof GetFileRequestSchema>) => client.getFile(request),

  updateFile: (request: MessageInitShape<typeof UpdateFileRequestSchema>) =>
    client.updateFile(request),

  deleteFile: (request: MessageInitShape<typeof DeleteFileRequestSchema>) =>
    client.deleteFile(request),

  restoreFile: (request: MessageInitShape<typeof RestoreFileRequestSchema>) =>
    client.restoreFile(request),

  createFolder: (request: MessageInitShape<typeof CreateFolderRequestSchema>) =>
    client.createFolder(request),

  updateFolder: (request: MessageInitShape<typeof UpdateFolderRequestSchema>) =>
    client.updateFolder(request),

  deleteFolder: (request: MessageInitShape<typeof DeleteFolderRequestSchema>) =>
    client.deleteFolder(request),

  getFilesTree: (request: MessageInitShape<typeof GetFilesTreeRequestSchema>) =>
    client.getFilesTree(request),

  moveItems: (request: MessageInitShape<typeof MoveItemsRequestSchema>) =>
    client.moveItems(request),

  // Permanent bulk deletes, trash purges, and copies do storage work server
  // side, so they get the slow tier instead of the interactive default.
  bulkDelete: (request: MessageInitShape<typeof BulkDeleteRequestSchema>) =>
    client.bulkDelete(request, { timeoutMs: SLOW_RPC_TIMEOUT_MS }),

  copyItems: (request: MessageInitShape<typeof CopyItemsRequestSchema>) =>
    client.copyItems(request, { timeoutMs: SLOW_RPC_TIMEOUT_MS }),

  listTrash: (request: MessageInitShape<typeof ListTrashRequestSchema>) =>
    client.listTrash(request),

  restoreFolder: (request: MessageInitShape<typeof RestoreFolderRequestSchema>) =>
    client.restoreFolder(request),

  emptyTrash: (request: MessageInitShape<typeof EmptyTrashRequestSchema>) =>
    client.emptyTrash(request, { timeoutMs: SLOW_RPC_TIMEOUT_MS }),

  listFileVersions: (request: MessageInitShape<typeof ListFileVersionsRequestSchema>) =>
    client.listFileVersions(request),

  restoreFileVersion: (request: MessageInitShape<typeof RestoreFileVersionRequestSchema>) =>
    client.restoreFileVersion(request),

  getStorageUsage: (request: MessageInitShape<typeof GetStorageUsageRequestSchema>) =>
    client.getStorageUsage(request),

  initiateUpload: (
    request: MessageInitShape<typeof InitiateUploadRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.initiateUpload(request, options),

  uploadChunk: (
    request: MessageInitShape<typeof UploadChunkRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.uploadChunk(request, { timeoutMs: SLOW_RPC_TIMEOUT_MS, ...options }),

  completeUpload: (
    request: MessageInitShape<typeof CompleteUploadRequestSchema>,
    options?: { signal?: AbortSignal },
  ) => client.completeUpload(request, { timeoutMs: SLOW_RPC_TIMEOUT_MS, ...options }),

  batchListAttachments: (request: MessageInitShape<typeof BatchListAttachmentsRequestSchema>) =>
    client.batchListAttachments(request),

  getAttachmentsFolder: (request: MessageInitShape<typeof GetAttachmentsFolderRequestSchema>) =>
    client.getAttachmentsFolder(request),
};
