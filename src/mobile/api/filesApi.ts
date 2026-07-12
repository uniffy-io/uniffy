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
import { transport } from "@/lib/transport";

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

  bulkDelete: (request: MessageInitShape<typeof BulkDeleteRequestSchema>) =>
    client.bulkDelete(request),

  copyItems: (request: MessageInitShape<typeof CopyItemsRequestSchema>) =>
    client.copyItems(request),

  listTrash: (request: MessageInitShape<typeof ListTrashRequestSchema>) =>
    client.listTrash(request),

  restoreFolder: (request: MessageInitShape<typeof RestoreFolderRequestSchema>) =>
    client.restoreFolder(request),

  emptyTrash: (request: MessageInitShape<typeof EmptyTrashRequestSchema>) =>
    client.emptyTrash(request),

  listFileVersions: (request: MessageInitShape<typeof ListFileVersionsRequestSchema>) =>
    client.listFileVersions(request),

  restoreFileVersion: (request: MessageInitShape<typeof RestoreFileVersionRequestSchema>) =>
    client.restoreFileVersion(request),

  getStorageUsage: (request: MessageInitShape<typeof GetStorageUsageRequestSchema>) =>
    client.getStorageUsage(request),

  initiateUpload: (request: MessageInitShape<typeof InitiateUploadRequestSchema>) =>
    client.initiateUpload(request),

  uploadChunk: (request: MessageInitShape<typeof UploadChunkRequestSchema>) =>
    client.uploadChunk(request),

  completeUpload: (request: MessageInitShape<typeof CompleteUploadRequestSchema>) =>
    client.completeUpload(request),

  batchListAttachments: (request: MessageInitShape<typeof BatchListAttachmentsRequestSchema>) =>
    client.batchListAttachments(request),

  getAttachmentsFolder: (request: MessageInitShape<typeof GetAttachmentsFolderRequestSchema>) =>
    client.getAttachmentsFolder(request),
};
