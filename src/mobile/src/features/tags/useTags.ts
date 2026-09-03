import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAuth } from "@core/providers/AuthContext";
import { tagsApi } from "@features/tags/tagsApi";
import { searchApi } from "@features/search/searchApi";
import {
  tagToPlain,
  taggedItemToPlain,
  type SerializedTag,
  type SerializedTaggedItem,
} from "@features/tags/tagSerializer";
import { TagSort } from "@uniffy/proto/tags/v1/tags_pb";

const NO_TYPES: ContentType[] = [];

/** Tags matching a search, narrowed to those carrying any of `contentTypes` (empty = all). */
export function useTags(query: string, contentTypes: ContentType[] = NO_TYPES) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["tags", organizationId, query, contentTypes],
    enabled: !!organizationId && isAuthenticated,
    // A filter change keeps the current list on screen until the narrowed one
    // arrives, instead of dropping to a spinner and remounting every card.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SerializedTag[]> => {
      const res = await tagsApi.listTags({
        organizationId: organizationId!,
        query: query.trim(),
        contentTypes,
        sort: TagSort.COUNT_DESC,
        pageSize: 200,
      });
      return res.tags.map(tagToPlain);
    },
  });
}

interface TagContentPage {
  items: SerializedTaggedItem[];
  nextPageToken: string | null;
}

export function useTagContent(tagId: string | undefined, contentTypes: ContentType[] = NO_TYPES) {
  const { organizationId, isAuthenticated } = useAuth();

  return useInfiniteQuery({
    queryKey: ["tag-content", organizationId, tagId, contentTypes],
    enabled: !!organizationId && !!tagId && isAuthenticated,
    // A filter change keeps the current list on screen until the narrowed one
    // arrives, instead of dropping to a spinner and remounting every card.
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<TagContentPage> => {
      const res = await tagsApi.listContentByTag({
        organizationId: organizationId!,
        tag: tagId!,
        contentTypes,
        pageSize: 50,
        pageToken: pageParam,
      });
      const urns = res.results.map((item) => item.urn);
      const resolved =
        urns.length > 0
          ? (await searchApi.resolveUrns({ organizationId: organizationId!, urns })).resolved
          : {};
      return {
        items: res.results.map((item) => taggedItemToPlain(item, resolved[item.urn])),
        nextPageToken: res.nextPageToken || null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
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
