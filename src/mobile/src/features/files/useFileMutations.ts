import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
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

const CHUNK_MAX_ATTEMPTS = 3;
const CHUNK_RETRY_BASE_MS = 1000;

type FileModule = {
  File: new (uri: string) => {
    exists: boolean;
    size: number;
    readableStream(): ReadableStream<Uint8Array>;
  };
};

// expo-file-system is a native module; a dev client built before it was added
// lacks it. The caller falls back to buffering the whole asset in memory.
function loadFileModule(): FileModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-file-system") as FileModule;
  } catch {
    return null;
  }
}

// A chunk is idempotent server-side (keyed by uploadId + chunkNumber), so a
// transient LTE drop retries the chunk instead of failing the whole upload.
async function uploadChunkWithRetry(
  request: Parameters<typeof filesApi.uploadChunk>[0],
  signal?: AbortSignal,
) {
  let retryDelayMs = CHUNK_RETRY_BASE_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await filesApi.uploadChunk(request, { signal });
    } catch (err) {
      if (signal?.aborted || attempt >= CHUNK_MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      retryDelayMs *= 2;
    }
  }
}

/**
 * Chunked upload of a local asset. Returns the completed File row. Streams
 * from disk when possible - buffering a phone video recording whole would
 * OOM the app - and falls back to buffering for non-file URIs.
 */
export async function uploadAsset(
  organizationId: string,
  args: UploadFileArgs,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) {
  const fs = args.uri.startsWith("file://") ? loadFileModule() : null;
  const source = fs ? new fs.File(args.uri) : null;

  let totalSize: number;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let buffered: Uint8Array | null = null;
  if (source && source.exists && source.size > 0) {
    totalSize = source.size;
    reader = source.readableStream().getReader();
  } else {
    // Not an RPC: reads the picker's local file:// URI into memory.
    // eslint-disable-next-line no-restricted-globals
    const fileResponse = await fetch(args.uri);
    buffered = new Uint8Array(await fileResponse.arrayBuffer());
    totalSize = buffered.length;
  }

  const initResponse = await filesApi.initiateUpload(
    {
      organizationId,
      filename: args.filename,
      mimeType: args.mimeType,
      totalSize: BigInt(totalSize),
      folderId: args.folderId,
      accessMode: AccessMode.OWNER_ONLY,
    },
    { signal },
  );

  const { uploadId, chunkSize, totalChunks } = initResponse;
  const size = Number(chunkSize);

  let bufferedOffset = 0;
  let pending = new Uint8Array(0);
  const readChunk = async (want: number): Promise<Uint8Array> => {
    if (buffered) {
      const chunk = buffered.subarray(bufferedOffset, bufferedOffset + want);
      bufferedOffset += chunk.length;
      return chunk;
    }
    while (pending.length < want) {
      const { done, value } = await reader!.read();
      if (done) break;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      pending = merged;
    }
    const chunk = pending.subarray(0, Math.min(want, pending.length));
    pending = pending.subarray(chunk.length);
    return chunk;
  };

  try {
    for (let i = 0; i < Number(totalChunks); i++) {
      if (signal?.aborted) throw new Error("Upload cancelled");
      const want = Math.min(size, totalSize - i * size);
      const chunk = await readChunk(want);
      if (chunk.length !== want) {
        throw new Error("Asset changed size during upload");
      }
      await uploadChunkWithRetry(
        { uploadId, chunkNumber: i + 1, data: chunk, isLast: i === Number(totalChunks) - 1 },
        signal,
      );
      onProgress?.(Math.round(((i + 1) / Number(totalChunks)) * 100));
    }
  } finally {
    reader?.cancel().catch(() => {});
  }

  return filesApi.completeUpload({ uploadId }, { signal });
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
