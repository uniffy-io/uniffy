/**
 * Comments API Service
 *
 * Centralized ConnectRPC client for comment operations.
 * Handles comments on content (notes, files, calendar events, etc.).
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { CommentsService } from '@uniffy/proto/comments/v1/comments_connect';
import type {
    CreateCommentRequest,
    UpdateCommentRequest,
    DeleteCommentRequest,
    ListCommentsRequest,
    GetCommentRequest,
    ResolveCommentRequest,
    ReopenCommentRequest,
    AddReactionRequest,
    RemoveReactionRequest,
    GetCommentCountsRequest,
} from '@uniffy/proto/comments/v1/comments_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a comments service client with the shared transport.
 */
const commentsClient = createClient(CommentsService, transport);

/**
 * Comments API service with typed methods.
 */
export const commentsApi = {
    /**
     * Create a new comment on content.
     */
    createComment: async (request: PartialMessage<CreateCommentRequest>) => {
        return commentsClient.createComment(request);
    },

    /**
     * Update an existing comment body.
     */
    updateComment: async (request: PartialMessage<UpdateCommentRequest>) => {
        return commentsClient.updateComment(request);
    },

    /**
     * Soft-delete a comment.
     */
    deleteComment: async (request: PartialMessage<DeleteCommentRequest>) => {
        return commentsClient.deleteComment(request);
    },

    /**
     * List comments for a piece of content.
     */
    listComments: async (request: PartialMessage<ListCommentsRequest>) => {
        return commentsClient.listComments(request);
    },

    /**
     * Get a single comment with its replies.
     */
    getComment: async (request: PartialMessage<GetCommentRequest>) => {
        return commentsClient.getComment(request);
    },

    /**
     * Resolve a comment thread.
     */
    resolveComment: async (request: PartialMessage<ResolveCommentRequest>) => {
        return commentsClient.resolveComment(request);
    },

    /**
     * Reopen a resolved comment thread.
     */
    reopenComment: async (request: PartialMessage<ReopenCommentRequest>) => {
        return commentsClient.reopenComment(request);
    },

    /**
     * Add a reaction to a comment.
     */
    addReaction: async (request: PartialMessage<AddReactionRequest>) => {
        return commentsClient.addReaction(request);
    },

    /**
     * Remove a reaction from a comment.
     */
    removeReaction: async (request: PartialMessage<RemoveReactionRequest>) => {
        return commentsClient.removeReaction(request);
    },

    /**
     * Get comment counts for multiple content items.
     */
    getCommentCounts: async (request: PartialMessage<GetCommentCountsRequest>) => {
        return commentsClient.getCommentCounts(request);
    },
};
