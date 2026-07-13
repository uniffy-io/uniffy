import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/auth-context";
import { filesApi } from "@features/files/filesApi";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

export function useDeleteFile() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fileId: string) =>
      filesApi.deleteFile({
        fileId,
        organizationId: organizationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

export function useRestoreFile() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fileId: string) =>
      filesApi.restoreFile({
        fileId,
        organizationId: organizationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

export function useCreateFolder() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { name: string; parentId?: string }) =>
      filesApi.createFolder({
        organizationId: organizationId!,
        name: args.name,
        parentId: args.parentId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

export function useDeleteFolder() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (folderId: string) =>
      filesApi.deleteFolder({
        folderId,
        organizationId: organizationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

export function useUpdateFile() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      fileId: string;
      filename?: string;
      description?: string;
      // Replacement tag id set. Empty array clears all manual tags; undefined
      // leaves them untouched (mirrors the proto FileTagIds wrapper contract).
      tagIds?: string[];
    }) =>
      filesApi.updateFile({
        fileId: args.fileId,
        organizationId: organizationId!,
        filename: args.filename,
        description: args.description,
        tagIds: args.tagIds !== undefined ? { ids: args.tagIds } : undefined,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
      queryClient.invalidateQueries({ queryKey: ["file", organizationId, variables.fileId] });
    },
  });
}

export function useUpdateFolder() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { folderId: string; name: string }) =>
      filesApi.updateFolder({
        folderId: args.folderId,
        organizationId: organizationId!,
        name: args.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

export interface UploadFileArgs {
  uri: string;
  filename: string;
  mimeType: string;
  size: number;
  folderId?: string;
}

/** Chunked upload of a local asset. Returns the completed File row. */
export async function uploadAsset(
  organizationId: string,
  args: UploadFileArgs,
  onProgress?: (percent: number) => void,
) {
  // Read bytes first: pickers do not always report a size, and initiate needs
  // an accurate total.
  const fileResponse = await fetch(args.uri);
  const arrayBuffer = await fileResponse.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const initResponse = await filesApi.initiateUpload({
    organizationId,
    filename: args.filename,
    mimeType: args.mimeType,
    totalSize: BigInt(bytes.length),
    folderId: args.folderId,
    accessMode: AccessMode.OWNER_ONLY,
  });

  const { uploadId, chunkSize, totalChunks } = initResponse;

  const size = Number(chunkSize);
  for (let i = 0; i < Number(totalChunks); i++) {
    const start = i * size;
    const end = Math.min(start + size, bytes.length);
    const chunk = bytes.slice(start, end);
    const isLast = i === Number(totalChunks) - 1;

    await filesApi.uploadChunk({
      uploadId,
      chunkNumber: i + 1,
      data: chunk,
      isLast,
    });

    onProgress?.(Math.round(((i + 1) / Number(totalChunks)) * 100));
  }

  return filesApi.completeUpload({ uploadId });
}

export function useUploadFile() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: async (args: UploadFileArgs) => {
      setProgress(0);
      return uploadAsset(organizationId!, args, setProgress);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
      setProgress(0);
    },
    onError: () => {
      setProgress(0);
    },
  });

  return { ...mutation, progress };
}

export function useMoveItems() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { fileIds?: string[]; folderIds?: string[]; targetFolderId?: string }) =>
      filesApi.moveItems({
        organizationId: organizationId!,
        fileIds: args.fileIds ?? [],
        folderIds: args.folderIds ?? [],
        targetFolderId: args.targetFolderId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

function useTrashInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["files"] });
    queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    queryClient.invalidateQueries({ queryKey: ["files-trash"] });
  };
}

export function useRestoreFolder() {
  const { organizationId } = useAuth();
  const invalidate = useTrashInvalidation();

  return useMutation({
    mutationFn: (folderId: string) =>
      filesApi.restoreFolder({ folderId, organizationId: organizationId! }),
    onSuccess: invalidate,
  });
}

export function useBulkDelete() {
  const { organizationId } = useAuth();
  const invalidate = useTrashInvalidation();

  return useMutation({
    mutationFn: (args: { fileIds?: string[]; folderIds?: string[]; permanent?: boolean }) =>
      filesApi.bulkDelete({
        organizationId: organizationId!,
        fileIds: args.fileIds ?? [],
        folderIds: args.folderIds ?? [],
        permanent: args.permanent ?? false,
      }),
    onSuccess: invalidate,
  });
}

export function useEmptyTrash() {
  const { organizationId } = useAuth();
  const invalidate = useTrashInvalidation();

  return useMutation({
    mutationFn: () => filesApi.emptyTrash({ organizationId: organizationId! }),
    onSuccess: invalidate,
  });
}

export function useCopyItems() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { fileIds: string[]; targetFolderId?: string }) =>
      filesApi.copyItems({
        organizationId: organizationId!,
        fileIds: args.fileIds,
        targetFolderId: args.targetFolderId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
    },
  });
}

export function useRestoreFileVersion() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { fileId: string; versionId: string }) =>
      filesApi.restoreFileVersion({
        fileId: args.fileId,
        organizationId: organizationId!,
        versionId: args.versionId,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["files-tree"] });
      queryClient.invalidateQueries({ queryKey: ["file", organizationId, variables.fileId] });
      queryClient.invalidateQueries({
        queryKey: ["file-versions", organizationId, variables.fileId],
      });
    },
  });
}
