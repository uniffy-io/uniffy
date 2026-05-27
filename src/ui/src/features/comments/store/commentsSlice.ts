import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { Comment as ProtoComment, CommentReaction as ProtoReaction } from '@uniffy/proto/comments/v1/comments_pb';

export interface SerializedComment {
    id: string;
    organizationId: string;
    contentType: number;
    contentId: string;
    parentCommentId: string;
    authorId: string;
    authorName: string;
    authorAvatarUrl: string;
    body: string;
    anchorType: number;
    anchorData: Record<string, unknown> | null;
    isResolved: boolean;
    resolvedById: string;
    resolvedByName: string;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string | null;
    replyCount: number;
    reactions: SerializedReaction[];
    replies: SerializedComment[];
}

export interface SerializedReaction {
    emoji: string;
    count: number;
    userIds: string[];
    currentUserReacted: boolean;
}

interface ContentComments {
    comments: SerializedComment[];
    totalCount: number;
    openCount: number;
    resolvedCount: number;
    loading: boolean;
    error: string | null;
}

interface CommentsState {
    commentsByContent: Record<string, ContentComments>;
    counts: Record<string, number>;
    activeCommentId: string | null;
    showResolved: boolean;
}

const initialState: CommentsState = {
    commentsByContent: {},
    counts: {},
    activeCommentId: null,
    showResolved: false,
};

export function serializeComment(comment: ProtoComment): SerializedComment {
    return {
        id: comment.id,
        organizationId: comment.organizationId,
        contentType: comment.contentType,
        contentId: comment.contentId,
        parentCommentId: comment.parentCommentId ?? '',
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorAvatarUrl: comment.authorAvatarUrl ?? '',
        body: comment.body,
        anchorType: comment.anchorType,
        anchorData: comment.anchorData ? comment.anchorData as Record<string, unknown> : null,
        isResolved: comment.isResolved,
        resolvedById: comment.resolvedById ?? '',
        resolvedByName: comment.resolvedByName ?? '',
        resolvedAt: comment.resolvedAt ? timestampDate(comment.resolvedAt).toISOString() : null,
        createdAt: comment.createdAt ? timestampDate(comment.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: comment.updatedAt ? timestampDate(comment.updatedAt).toISOString() : null,
        replyCount: comment.replyCount,
        reactions: comment.reactions.map(serializeReaction),
        replies: comment.replies.map(serializeComment),
    };
}

function serializeReaction(reaction: ProtoReaction): SerializedReaction {
    return {
        emoji: reaction.emoji,
        count: reaction.count,
        userIds: [...reaction.userIds],
        currentUserReacted: reaction.currentUserReacted,
    };
}

function contentKey(contentType: number, contentId: string): string {
    return `${contentType}:${contentId}`;
}

const commentsSlice = createSlice({
    name: 'comments',
    initialState,
    reducers: {
        setCommentsLoading(
            state,
            action: PayloadAction<{ contentType: number; contentId: string; loading: boolean }>
        ) {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            if (!state.commentsByContent[key]) {
                state.commentsByContent[key] = {
                    comments: [],
                    totalCount: 0,
                    openCount: 0,
                    resolvedCount: 0,
                    loading: true,
                    error: null,
                };
            }
            state.commentsByContent[key].loading = action.payload.loading;
        },
        setComments(
            state,
            action: PayloadAction<{
                contentType: number;
                contentId: string;
                comments: SerializedComment[];
                totalCount: number;
                openCount: number;
                resolvedCount: number;
            }>
        ) {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            state.commentsByContent[key] = {
                comments: action.payload.comments,
                totalCount: action.payload.totalCount,
                openCount: action.payload.openCount,
                resolvedCount: action.payload.resolvedCount,
                loading: false,
                error: null,
            };
        },
        setCommentsError(
            state,
            action: PayloadAction<{ contentType: number; contentId: string; error: string }>
        ) {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            if (state.commentsByContent[key]) {
                state.commentsByContent[key].loading = false;
                state.commentsByContent[key].error = action.payload.error;
            }
        },
        addComment(
            state,
            action: PayloadAction<{ contentType: number; contentId: string; comment: SerializedComment }>
        ) {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            if (state.commentsByContent[key]) {
                // Reply thread merge: top-level comments push into the list; replies arrive nested under their parent.
                if (!action.payload.comment.parentCommentId) {
                    state.commentsByContent[key].comments.push(action.payload.comment);
                    state.commentsByContent[key].totalCount += 1;
                    state.commentsByContent[key].openCount += 1;
                }
            }
        },
        updateCommentInList(
            state,
            action: PayloadAction<{ contentType: number; contentId: string; comment: SerializedComment }>
        ) {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            const content = state.commentsByContent[key];
            if (content) {
                const idx = content.comments.findIndex(c => c.id === action.payload.comment.id);
                if (idx !== -1) {
                    content.comments[idx] = action.payload.comment;
                }
            }
        },
        removeComment(
            state,
            action: PayloadAction<{ contentType: number; contentId: string; commentId: string }>
        ) {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            const content = state.commentsByContent[key];
            if (content) {
                const idx = content.comments.findIndex(c => c.id === action.payload.commentId);
                if (idx !== -1) {
                    const wasResolved = content.comments[idx].isResolved;
                    content.comments.splice(idx, 1);
                    content.totalCount = Math.max(0, content.totalCount - 1);
                    if (wasResolved) {
                        content.resolvedCount = Math.max(0, content.resolvedCount - 1);
                    } else {
                        content.openCount = Math.max(0, content.openCount - 1);
                    }
                }
            }
        },
        setCounts(state, action: PayloadAction<Record<string, number>>) {
            state.counts = { ...state.counts, ...action.payload };
        },
        setActiveComment(state, action: PayloadAction<string | null>) {
            state.activeCommentId = action.payload;
        },
        setShowResolved(state, action: PayloadAction<boolean>) {
            state.showResolved = action.payload;
        },
        clearComments(state) {
            state.commentsByContent = {};
            state.counts = {};
            state.activeCommentId = null;
            state.showResolved = false;
        },
    },
});

export const {
    setCommentsLoading,
    setComments,
    setCommentsError,
    addComment,
    updateCommentInList,
    removeComment,
    setCounts,
    setActiveComment,
    setShowResolved,
    clearComments,
} = commentsSlice.actions;

export const commentsReducer = commentsSlice.reducer;
