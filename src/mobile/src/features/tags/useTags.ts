import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/auth-context";
import { tagsApi } from "@features/tags/tagsApi";
import {
  tagToPlain,
  taggedItemToPlain,
  type SerializedTag,
  type SerializedTaggedItem,
} from "@features/tags/tagSerializer";
import { TagSort } from "@uniffy/proto/tags/v1/tags_pb";

export function useTags(query: string) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["tags", organizationId, query],
    enabled: !!organizationId && isAuthenticated,
    queryFn: async (): Promise<SerializedTag[]> => {
      const res = await tagsApi.listTags({
        organizationId: organizationId!,
        query: query.trim(),
        sort: TagSort.COUNT_DESC,
        pageSize: 200,
      });
      return res.tags.map(tagToPlain);
    },
  });
}

export function useTagContent(tagId: string | undefined) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["tag-content", organizationId, tagId],
    enabled: !!organizationId && !!tagId && isAuthenticated,
    queryFn: async (): Promise<SerializedTaggedItem[]> => {
      const res = await tagsApi.listContentByTag({
        organizationId: organizationId!,
        tag: tagId!,
        pageSize: 100,
      });
      return res.results.map(taggedItemToPlain);
    },
  });
}

export function useTagMutations() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tags", organizationId] });

  const create = useMutation({
    mutationFn: (args: { name: string; color: string; description?: string }) =>
      tagsApi.createTag({
        organizationId: organizationId!,
        name: args.name,
        color: args.color,
        description: args.description ?? "",
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (args: { tagId: string; name?: string; color?: string; description?: string }) =>
      tagsApi.updateTag({
        organizationId: organizationId!,
        tagId: args.tagId,
        name: args.name,
        color: args.color,
        description: args.description,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (tagId: string) => tagsApi.deleteTag({ organizationId: organizationId!, tagId }),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}
