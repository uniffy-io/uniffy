import { toast } from 'sonner';
import type { AppDispatch } from '@/app/store';
import { friendlyErrorMessage } from '@/config/errorMessages';
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
import type { CommentAnchorType } from '@uniffy/proto/comments/v1/comments_pb';
import type { JsonObject } from '@bufbuild/protobuf';

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
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
    }
};

export const createComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    body: string,
    anchorType?: CommentAnchorType,
    anchorData?: JsonObject,
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
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
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
    try {
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
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update comment';
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
        throw error;
    }
};

export const deleteComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
) => async (dispatch: AppDispatch) => {
    try {
        await commentsApi.deleteComment({
            organizationId,
            commentId,
        });
        dispatch(removeComment({ contentType, contentId, commentId }));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete comment';
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
        throw error;
    }
};

export const resolveComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
) => async (dispatch: AppDispatch) => {
    try {
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
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to resolve comment';
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
        throw error;
    }
};

export const reopenComment = (
    organizationId: string,
    contentType: number,
    contentId: string,
    commentId: string,
) => async (dispatch: AppDispatch) => {
    try {
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
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reopen comment';
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
        throw error;
    }
};

export const addReaction = (
    organizationId: string,
    commentId: string,
    emoji: string,
) => async () => {
    try {
        await commentsApi.addReaction({ organizationId, commentId, emoji });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to add reaction';
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
    }
};

export const removeReaction = (
    organizationId: string,
    commentId: string,
    emoji: string,
) => async () => {
    try {
        await commentsApi.removeReaction({ organizationId, commentId, emoji });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove reaction';
        const friendly = friendlyErrorMessage(message);
        if (friendly) toast.error(friendly);
    }
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
        // Non-fatal - comment counts are supplementary
    }
};
