import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { filesApi } from "@/api/filesApi";
import { fileToPlain, treeNodeToPlain } from "@/lib/fileSerializer";
import type { SerializedFile, PlainTreeNode } from "@/lib/fileSerializer";

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

export function useFilesTree() {
  const { organizationId } = useAuth();

  return useQuery<PlainTreeNode[]>({
    queryKey: ["files-tree", organizationId],
    queryFn: async () => {
      const response = await filesApi.getFilesTree({
        organizationId: organizationId!,
      });
      return response.nodes.map(treeNodeToPlain);
    },
    enabled: !!organizationId,
  });
}
