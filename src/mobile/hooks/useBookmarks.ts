import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { bookmarksApi } from "@/api/bookmarksApi";

export function useBookmarkedNoteUrns() {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["bookmarks", organizationId],
    enabled: !!organizationId && isAuthenticated,
    queryFn: async () => {
      const response = await bookmarksApi.listBookmarks({
        organizationId: organizationId!,
      });
      return response.bookmarks.map((b) => b.urn);
    },
  });
}

export function useIsBookmarked(urn: string) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["bookmark-check", organizationId, urn],
    enabled: !!organizationId && !!urn && isAuthenticated,
    queryFn: async () => {
      const response = await bookmarksApi.bulkCheckBookmarks({
        organizationId: organizationId!,
        urns: [urn],
      });
      return response.bookmarkedUrns[urn] ?? false;
    },
    staleTime: 30_000,
  });
}

export function useToggleBookmark() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (urn: string) =>
      bookmarksApi.toggleBookmark({
        organizationId: organizationId!,
        urn,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookmarks", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["bookmark-items", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["bookmark-check", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}
