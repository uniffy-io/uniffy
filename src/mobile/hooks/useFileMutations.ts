import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { filesApi } from "@/api/filesApi";
import { VisibilityScope } from "@uniffy/proto/common/v1/common_pb";

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

export interface UploadFileArgs {
  uri: string;
  filename: string;
  mimeType: string;
  size: number;
  folderId?: string;
}

export function useUploadFile() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: async (args: UploadFileArgs) => {
      setProgress(0);

      const initResponse = await filesApi.initiateUpload({
        organizationId: organizationId!,
        filename: args.filename,
        mimeType: args.mimeType,
        totalSize: BigInt(args.size),
        folderId: args.folderId,
        visibility: VisibilityScope.PRIVATE,
      });

      const { uploadId, chunkSize, totalChunks } = initResponse;

      const fileResponse = await fetch(args.uri);
      const arrayBuffer = await fileResponse.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

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

        setProgress(Math.round(((i + 1) / Number(totalChunks)) * 100));
      }

      return filesApi.completeUpload({ uploadId });
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
    mutationFn: (args: { fileIds?: string[]; folderIds?: string[]; targetFolderId: string }) =>
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
