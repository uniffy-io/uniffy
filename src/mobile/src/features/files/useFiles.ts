import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/auth-context";
import { filesApi } from "@features/files/filesApi";
import { fileToPlain, treeNodeToPlain, formatSize } from "@features/files/fileSerializer";
import type { SerializedFile, PlainTreeNode } from "@features/files/fileSerializer";

export type FileListItem = SerializedFile;

export function useFile(fileId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["file", organizationId, fileId],
    queryFn: async () => {
      const response = await filesApi.getFile({
        fileId: fileId!,
        organizationId: organizationId!,
      });
      if (!response.file) throw new Error("File not found");
      return fileToPlain(response.file);
    },
    enabled: !!organizationId && !!fileId,
  });
}

export function useFilesTree(personalOnly = false) {
  const { organizationId } = useAuth();

  return useQuery<PlainTreeNode[]>({
    queryKey: ["files-tree", organizationId, personalOnly],
    queryFn: async () => {
      const response = await filesApi.getFilesTree({
        organizationId: organizationId!,
        personalOnly,
        // The mobile browser derives both folders AND files from this tree, so
        // files must be included; otherwise folders report a child count they
        // cannot show (e.g. the Attachments folder reads "8 items" but opens empty).
        includeFiles: true,
      });
      return response.nodes.map(treeNodeToPlain);
    },
    enabled: !!organizationId,
  });
}

export interface StorageUsage {
  usedBytes: number;
  used: string;
  quotaBytes?: number;
  quota?: string;
  usagePercent: number;
}

export function useStorageUsage() {
  const { organizationId } = useAuth();

  return useQuery<StorageUsage>({
    queryKey: ["storage-usage", organizationId],
    queryFn: async () => {
      const response = await filesApi.getStorageUsage({ organizationId: organizationId! });
      const usage = response.usage;
      const usedBytes = Number(usage?.usedBytes ?? 0n);
      const quotaBytes =
        usage?.effectiveQuotaBytes !== undefined ? Number(usage.effectiveQuotaBytes) : undefined;
      return {
        usedBytes,
        used: formatSize(usedBytes),
        quotaBytes,
        quota: quotaBytes !== undefined ? formatSize(quotaBytes) : undefined,
        usagePercent: usage?.usagePercent ?? 0,
      };
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

export interface TrashFolder {
  id: string;
  name: string;
}

export interface TrashContents {
  files: SerializedFile[];
  folders: TrashFolder[];
}

export function useFilesTrash() {
  const { organizationId } = useAuth();

  return useQuery<TrashContents>({
    queryKey: ["files-trash", organizationId],
    queryFn: async () => {
      const response = await filesApi.listTrash({ organizationId: organizationId! });
      return {
        files: response.files.map(fileToPlain),
        folders: response.folders.map((f) => ({ id: f.id, name: f.name })),
      };
    },
    enabled: !!organizationId,
  });
}

export interface FileVersionInfo {
  id: string;
  versionNumber: number;
  size: string;
  createdAt: string;
}

export function useFileVersions(fileId: string | undefined, enabled: boolean) {
  const { organizationId } = useAuth();

  return useQuery<FileVersionInfo[]>({
    queryKey: ["file-versions", organizationId, fileId],
    queryFn: async () => {
      const response = await filesApi.listFileVersions({
        fileId: fileId!,
        organizationId: organizationId!,
      });
      return response.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        size: formatSize(Number(v.sizeBytes)),
        createdAt: new Date(
          Number(v.createdAt?.seconds ?? 0n) * 1000 + Math.floor((v.createdAt?.nanos ?? 0) / 1e6),
        ).toISOString(),
      }));
    },
    enabled: enabled && !!organizationId && !!fileId,
  });
}
