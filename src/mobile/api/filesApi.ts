import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { FilesService } from "@/gen/files/v1/files_connect";
import type {
  ListFilesRequest,
  GetFileRequest,
  UpdateFileRequest,
  DeleteFileRequest,
  RestoreFileRequest,
  CreateFolderRequest,
  UpdateFolderRequest,
  DeleteFolderRequest,
  GetFilesTreeRequest,
  MoveItemsRequest,
  BulkDeleteRequest,
  InitiateUploadRequest,
  UploadChunkRequest,
  CompleteUploadRequest,
} from "@/gen/files/v1/files_pb";
import { transport } from "@/lib/transport";

const client = createClient(FilesService, transport);

export const filesApi = {
  listFiles: (request: PartialMessage<ListFilesRequest>) => client.listFiles(request),

  getFile: (request: PartialMessage<GetFileRequest>) => client.getFile(request),

  updateFile: (request: PartialMessage<UpdateFileRequest>) => client.updateFile(request),

  deleteFile: (request: PartialMessage<DeleteFileRequest>) => client.deleteFile(request),

  restoreFile: (request: PartialMessage<RestoreFileRequest>) => client.restoreFile(request),

  createFolder: (request: PartialMessage<CreateFolderRequest>) => client.createFolder(request),

  updateFolder: (request: PartialMessage<UpdateFolderRequest>) => client.updateFolder(request),

  deleteFolder: (request: PartialMessage<DeleteFolderRequest>) => client.deleteFolder(request),

  getFilesTree: (request: PartialMessage<GetFilesTreeRequest>) => client.getFilesTree(request),

  moveItems: (request: PartialMessage<MoveItemsRequest>) => client.moveItems(request),

  bulkDelete: (request: PartialMessage<BulkDeleteRequest>) => client.bulkDelete(request),

  initiateUpload: (request: PartialMessage<InitiateUploadRequest>) =>
    client.initiateUpload(request),

  uploadChunk: (request: PartialMessage<UploadChunkRequest>) => client.uploadChunk(request),

  completeUpload: (request: PartialMessage<CompleteUploadRequest>) =>
    client.completeUpload(request),
};
