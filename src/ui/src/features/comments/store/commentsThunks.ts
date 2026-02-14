import type { AppDispatch } from '@/app/store';
import { commentsApi } from '@/features/comments/api/commentsApi';
import {
    setCommentsLoading,
    setComments,
    setCommentsError,
    addComment,
    updateCommentInList,
    removeComment,
    setCounts,
    serializeComment,
} from '@/features/comments/store/commentsSlice';
import type { CommentAnchorType } from '@/gen/comments/v1/comments_pb';
import type { Struct } from '@bufbuild/protobuf';

export const fetchComments = (
    organizationId: string,
    contentType: number,
    contentId: string,
    isResolved?: boolean,
    anchorType?: CommentAnchorType,
    page = 1,
    pageSize = 50,
) => async (dispatch: AppDispatch) => {
    dispatch(setCommentsLoading({ contentType, contentId, loading: true }));
    try {
        const response = await commentsApi.listComments({
            organizationId,
            contentType,
            contentId,
            isResolved,
            anchorType,
            page,
            pageSize,
        });
        dispatch(setComments({
            contentType,
            contentId,
            comments: response.comments.map(serializeComment),
            totalCount: response.totalCount,
            openCount: response.openCount,
            resolvedCount: response.resolvedCount,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load comments';
        dispatch(setCommentsError({ contentType, contentId, error: message }));
    }
};

export const createComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    body: string,
    anchorType?: CommentAnchorType,
    anchorData?: Struct,
    parentCommentId?: string,
) => async (dispatch: AppDispatch) => {
    try {
        const response = await commentsApi.createComment({
            organizationId,
            contentType,
            contentId,
            body,
            anchorType,
            anchorData,
            parentCommentId,
        });
        if (response.comment) {
            dispatch(addComment({
                contentType,
                contentId,
                comment: serializeComment(response.comment),
            }));
        }
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create comment';
        dispatch(setCommentsError({ contentType, contentId, error: message }));
        throw error;
    }
};

export const updateComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
    body: string,
) => async (dispatch: AppDispatch) => {
    const response = await commentsApi.updateComment({
        organizationId,
        commentId,
        body,
    });
    if (response.comment) {
        dispatch(updateCommentInList({
            contentType,
            contentId,
            comment: serializeComment(response.comment),
        }));
    }
    return response;
};

export const deleteComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
) => async (dispatch: AppDispatch) => {
    await commentsApi.deleteComment({
        organizationId,
        commentId,
    });
    dispatch(removeComment({ contentType, contentId, commentId }));
};

export const resolveComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
) => async (dispatch: AppDispatch) => {
    const response = await commentsApi.resolveComment({
        organizationId,
        commentId,
    });
    if (response.comment) {
        dispatch(updateCommentInList({
            contentType,
            contentId,
            comment: serializeComment(response.comment),
        }));
    }
    // Re-fetch to update counts
    dispatch(fetchComments(organizationId, contentType, contentId));
};

export const reopenComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
) => async (dispatch: AppDispatch) => {
    const response = await commentsApi.reopenComment({
        organizationId,
        commentId,
    });
    if (response.comment) {
        dispatch(updateCommentInList({
            contentType,
            contentId,
            comment: serializeComment(response.comment),
        }));
    }
    // Re-fetch to update counts
    dispatch(fetchComments(organizationId, contentType, contentId));
};

export const addReaction = (
    organizationId: string,
    commentId: string,
    emoji: string,
) => async () => {
    await commentsApi.addReaction({ organizationId, commentId, emoji });
};

export const removeReaction = (
    organizationId: string,
    commentId: string,
    emoji: string,
) => async () => {
    await commentsApi.removeReaction({ organizationId, commentId, emoji });
};

export const fetchCommentCounts = (
    organizationId: string,
    contentRefs: Array<{ contentType: number; contentId: string }>,
) => async (dispatch: AppDispatch) => {
    if (contentRefs.length === 0) return;
    try {
        const response = await commentsApi.getCommentCounts({
            organizationId,
            contentRefs,
        });
        const counts: Record<string, number> = {};
        for (const [key, value] of Object.entries(response.counts)) {
            counts[key] = value;
        }
        dispatch(setCounts(counts));
    } catch {
        // Non-fatal
    }
};
