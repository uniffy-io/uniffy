import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setActiveComment,
    setShowResolved,
} from '@/features/comments/store/commentsSlice';
import {
    fetchComments,
    createComment,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    addReaction,
    removeReaction,
    fetchCommentCounts,
} from '@/features/comments/store/commentsThunks';
import type { CommentAnchorType } from '@uniffy/proto/comments/v1/comments_pb';
import type { Struct } from '@bufbuild/protobuf';

/**
 * Hook for fetching and accessing comments for a content item.
 */
export function useComments(contentType: number, contentId: string) {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const key = `${contentType}:${contentId}`;
    const data = useAppSelector((state) => state.comments.commentsByContent[key]);

    const refresh = useCallback(() => {
        if (organizationId && contentId) {
            dispatch(fetchComments(organizationId, contentType, contentId));
        }
    }, [dispatch, organizationId, contentType, contentId]);

    useEffect(() => {
        if (organizationId && contentId) {
            dispatch(fetchComments(organizationId, contentType, contentId));
        }
    }, [dispatch, organizationId, contentType, contentId]);

    return {
        comments: data?.comments ?? [],
        totalCount: data?.totalCount ?? 0,
        openCount: data?.openCount ?? 0,
        resolvedCount: data?.resolvedCount ?? 0,
        loading: data?.loading ?? false,
        error: data?.error ?? null,
        refresh,
    };
}

/**
 * Hook for getting comment count for a content item (for badges).
 */
export function useCommentCount(contentType: number, contentId: string) {
    const key = `${contentType}:${contentId}`;
    return useAppSelector((state) => state.comments.counts[key] ?? 0);
}

/**
 * Hook for comment actions (create, update, delete, resolve, etc.).
 */
export function useCommentActions() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    const create = useCallback(async (
        contentType: number,
        contentId: string,
        body: string,
        anchorType?: CommentAnchorType,
        anchorData?: Struct,
        parentCommentId?: string,
    ) => {
        if (!organizationId) return;
        return dispatch(createComment(
            organizationId, contentType, contentId,
            body, anchorType, anchorData, parentCommentId,
        ));
    }, [dispatch, organizationId]);

    const update = useCallback(async (
        contentType: number,
        contentId: string,
        commentId: string,
        body: string,
    ) => {
        if (!organizationId) return;
        return dispatch(updateComment(
            organizationId, contentType, contentId, commentId, body,
        ));
    }, [dispatch, organizationId]);

    const remove = useCallback(async (
        contentType: number,
        contentId: string,
        commentId: string,
    ) => {
        if (!organizationId) return;
        return dispatch(deleteComment(
            organizationId, contentType, contentId, commentId,
        ));
    }, [dispatch, organizationId]);

    const resolve = useCallback(async (
        contentType: number,
        contentId: string,
        commentId: string,
    ) => {
        if (!organizationId) return;
        return dispatch(resolveComment(
            organizationId, contentType, contentId, commentId,
        ));
    }, [dispatch, organizationId]);

    const reopen = useCallback(async (
        contentType: number,
        contentId: string,
        commentId: string,
    ) => {
        if (!organizationId) return;
        return dispatch(reopenComment(
            organizationId, contentType, contentId, commentId,
        ));
    }, [dispatch, organizationId]);

    const react = useCallback(async (commentId: string, emoji: string) => {
        if (!organizationId) return;
        return dispatch(addReaction(organizationId, commentId, emoji));
    }, [dispatch, organizationId]);

    const unreact = useCallback(async (commentId: string, emoji: string) => {
        if (!organizationId) return;
        return dispatch(removeReaction(organizationId, commentId, emoji));
    }, [dispatch, organizationId]);

    const fetchCounts = useCallback(async (
        refs: Array<{ contentType: number; contentId: string }>,
    ) => {
        if (!organizationId) return;
        return dispatch(fetchCommentCounts(organizationId, refs));
    }, [dispatch, organizationId]);

    return { create, update, remove, resolve, reopen, react, unreact, fetchCounts };
}

/**
 * Hook for getting/setting the active comment ID.
 */
export function useActiveComment() {
    const dispatch = useAppDispatch();
    const activeCommentId = useAppSelector((state) => state.comments.activeCommentId);
    const showResolved = useAppSelector((state) => state.comments.showResolved);

    const setActive = useCallback((id: string | null) => {
        dispatch(setActiveComment(id));
    }, [dispatch]);

    const toggleResolved = useCallback((show: boolean) => {
        dispatch(setShowResolved(show));
    }, [dispatch]);

    return { activeCommentId, setActive, showResolved, toggleResolved };
}
