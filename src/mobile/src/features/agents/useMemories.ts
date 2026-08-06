import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MemoryCategory, MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import { useAuth } from "@core/providers/AuthContext";
import { memoriesApi } from "@features/agents/memoriesApi";
import {
  memoryToPlain,
  type MemorySubject,
  type SerializedMemory,
} from "@features/agents/memorySerializer";

const PAGE_SIZE = 100;

function memoriesKey(orgId: string | null, subject: MemorySubject) {
  return ["agents", "memories", orgId, subject.scope, subject.subjectId ?? ""];
}

function subjectRequestFields(subject: MemorySubject) {
  return {
    scope: subject.scope,
    channelId: subject.scope === MemoryScope.CHANNEL ? subject.subjectId : undefined,
    sessionId: subject.scope === MemoryScope.SESSION ? subject.subjectId : undefined,
  };
}

/** Entries in one audience bucket, pinned first then most recently updated. */
export function useMemories(subject: MemorySubject, enabled: boolean) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: memoriesKey(organizationId, subject),
    enabled: enabled && !!organizationId,
    queryFn: async (): Promise<SerializedMemory[]> => {
      const res = await memoriesApi.listMemories({
        organizationId: organizationId!,
        ...subjectRequestFields(subject),
        pagination: { page: 1, pageSize: PAGE_SIZE },
      });
      return res.memories
        .map(memoryToPlain)
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAtSeconds - a.updatedAtSeconds,
        );
    },
  });
}

export function useMemoryMutations(subject: MemorySubject) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = memoriesKey(organizationId, subject);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (args: {
      key: string;
      content: string;
      description: string;
      category: MemoryCategory;
    }) =>
      memoriesApi.createMemory({
        organizationId: organizationId!,
        ...subjectRequestFields(subject),
        ...args,
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (args: {
      memoryId: string;
      content?: string;
      description?: string;
      category?: MemoryCategory;
    }) => memoriesApi.updateMemory({ organizationId: organizationId!, ...args }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (memoryId: string) =>
      memoriesApi.deleteMemory({ organizationId: organizationId!, memoryId }),
    onSuccess: invalidate,
  });

  const setPinned = useMutation({
    mutationFn: (args: { memoryId: string; pinned: boolean }) =>
      memoriesApi.setMemoryPinned({ organizationId: organizationId!, ...args }),
    onSuccess: invalidate,
  });

  return { create, update, remove, setPinned };
}
