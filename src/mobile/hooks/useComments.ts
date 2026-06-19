import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { commentsApi } from "@/api/commentsApi";
import { commentToPlain, type SerializedComment } from "@/lib/commentSerializer";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { CommentAnchorType } from "@uniffy/proto/comments/v1/comments_pb";

export interface CommentThread {
  comments: SerializedComment[];
  totalCount: number;
  openCount: number;
  resolvedCount: number;
}

function key(orgId: string | null, contentType: ContentType, contentId: string) {
  return ["comments", orgId, contentType, contentId];
}

export function useComments(contentType: ContentType, contentId: string | undefined) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: key(organizationId, contentType, contentId ?? ""),
    enabled: !!organizationId && !!contentId && isAuthenticated,
    queryFn: async (): Promise<CommentThread> => {
      const res = await commentsApi.listComments({
        organizationId: organizationId!,
        contentType,
        contentId: contentId!,
        page: 1,
        pageSize: 100,
      });
      return {
        comments: res.comments.map(commentToPlain),
        totalCount: res.totalCount,
        openCount: res.openCount,
        resolvedCount: res.resolvedCount,
      };
    },
  });
}

/** Lightweight count for header badges. */
export function useCommentCount(contentType: ContentType, contentId: string | undefined) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["comment-count", organizationId, contentType, contentId],
    enabled: !!organizationId && !!contentId && isAuthenticated,
    queryFn: async () => {
      const res = await commentsApi.getCommentCounts({
        organizationId: organizationId!,
        contentRefs: [{ contentType, contentId: contentId! }],
      });
      return res.counts[`${contentType}:${contentId}`] ?? 0;
    },
  });
}

export function useCommentMutations(contentType: ContentType, contentId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key(organizationId, contentType, contentId) });
    queryClient.invalidateQueries({ queryKey: ["comment-count", organizationId, contentType, contentId] });
  };

  const create = useMutation({
    mutationFn: (args: { body: string; parentCommentId?: string }) =>
      commentsApi.createComment({
        organizationId: organizationId!,
        contentType,
        contentId,
        body: args.body,
        parentCommentId: args.parentCommentId,
        anchorType: CommentAnchorType.PAGE,
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (args: { commentId: string; body: string }) =>
      commentsApi.updateComment({
        organizationId: organizationId!,
        commentId: args.commentId,
        body: args.body,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      commentsApi.deleteComment({ organizationId: organizationId!, commentId }),
    onSuccess: invalidate,
  });

  const setResolved = useMutation({
    mutationFn: async (args: { commentId: string; resolved: boolean }) => {
      if (args.resolved) {
        await commentsApi.resolveComment({ organizationId: organizationId!, commentId: args.commentId });
      } else {
        await commentsApi.reopenComment({ organizationId: organizationId!, commentId: args.commentId });
      }
    },
    onSuccess: invalidate,
  });

  const toggleReaction = useMutation({
    mutationFn: async (args: { commentId: string; emoji: string; add: boolean }) => {
      if (args.add) {
        await commentsApi.addReaction({
          organizationId: organizationId!,
          commentId: args.commentId,
          emoji: args.emoji,
        });
      } else {
        await commentsApi.removeReaction({
          organizationId: organizationId!,
          commentId: args.commentId,
          emoji: args.emoji,
        });
      }
    },
    onSuccess: invalidate,
  });

  return { create, update, remove, setResolved, toggleReaction };
}
