import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { FilesService, BulkDeleteRequestSchema, CompleteUploadRequestSchema, CreateFolderRequestSchema, DeleteFileRequestSchema, DeleteFolderRequestSchema, GetFileRequestSchema, GetFilesTreeRequestSchema, InitiateUploadRequestSchema, ListFilesRequestSchema, MoveItemsRequestSchema, RestoreFileRequestSchema, UpdateFileRequestSchema, UpdateFolderRequestSchema, UploadChunkRequestSchema } from "@uniffy/proto/files/v1/files_pb";
import { transport } from "@/lib/transport";

const client = createClient(FilesService, transport);

export const filesApi = {
  listFiles: (request: MessageInitShape<typeof ListFilesRequestSchema>) => client.listFiles(request),

  getFile: (request: MessageInitShape<typeof GetFileRequestSchema>) => client.getFile(request),

  updateFile: (request: MessageInitShape<typeof UpdateFileRequestSchema>) => client.updateFile(request),

  deleteFile: (request: MessageInitShape<typeof DeleteFileRequestSchema>) => client.deleteFile(request),

  restoreFile: (request: MessageInitShape<typeof RestoreFileRequestSchema>) => client.restoreFile(request),

  createFolder: (request: MessageInitShape<typeof CreateFolderRequestSchema>) => client.createFolder(request),

  updateFolder: (request: MessageInitShape<typeof UpdateFolderRequestSchema>) => client.updateFolder(request),

  deleteFolder: (request: MessageInitShape<typeof DeleteFolderRequestSchema>) => client.deleteFolder(request),

  getFilesTree: (request: MessageInitShape<typeof GetFilesTreeRequestSchema>) => client.getFilesTree(request),

  moveItems: (request: MessageInitShape<typeof MoveItemsRequestSchema>) => client.moveItems(request),

  bulkDelete: (request: MessageInitShape<typeof BulkDeleteRequestSchema>) => client.bulkDelete(request),

  initiateUpload: (request: MessageInitShape<typeof InitiateUploadRequestSchema>) =>
    client.initiateUpload(request),

  uploadChunk: (request: MessageInitShape<typeof UploadChunkRequestSchema>) => client.uploadChunk(request),

  completeUpload: (request: MessageInitShape<typeof CompleteUploadRequestSchema>) =>
    client.completeUpload(request),
};
