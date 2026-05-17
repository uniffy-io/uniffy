/**
 * Comments API Service
 *
 * Centralized ConnectRPC client for comment operations.
 * Handles comments on content (notes, files, calendar events, etc.).
 */

import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { CommentsService, AddReactionRequestSchema, CreateCommentRequestSchema, DeleteCommentRequestSchema, GetCommentCountsRequestSchema, GetCommentRequestSchema, ListCommentsRequestSchema, RemoveReactionRequestSchema, ReopenCommentRequestSchema, ResolveCommentRequestSchema, UpdateCommentRequestSchema } from '@uniffy/proto/comments/v1/comments_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a comments service client with the shared transport.
 */
const commentsClient = createClient(CommentsService, unaryTransport);

/**
 * Comments API service with typed methods.
 */
export const commentsApi = {
    /**
     * Create a new comment on content.
     */
    createComment: async (request: MessageInitShape<typeof CreateCommentRequestSchema>) => {
        return commentsClient.createComment(request);
    },

    /**
     * Update an existing comment body.
     */
    updateComment: async (request: MessageInitShape<typeof UpdateCommentRequestSchema>) => {
        return commentsClient.updateComment(request);
    },

    /**
     * Soft-delete a comment.
     */
    deleteComment: async (request: MessageInitShape<typeof DeleteCommentRequestSchema>) => {
        return commentsClient.deleteComment(request);
    },

    /**
     * List comments for a piece of content.
     */
    listComments: async (request: MessageInitShape<typeof ListCommentsRequestSchema>) => {
        return commentsClient.listComments(request);
    },

    /**
     * Get a single comment with its replies.
     */
    getComment: async (request: MessageInitShape<typeof GetCommentRequestSchema>) => {
        return commentsClient.getComment(request);
    },

    /**
     * Resolve a comment thread.
     */
    resolveComment: async (request: MessageInitShape<typeof ResolveCommentRequestSchema>) => {
        return commentsClient.resolveComment(request);
    },

    /**
     * Reopen a resolved comment thread.
     */
    reopenComment: async (request: MessageInitShape<typeof ReopenCommentRequestSchema>) => {
        return commentsClient.reopenComment(request);
    },

    /**
     * Add a reaction to a comment.
     */
    addReaction: async (request: MessageInitShape<typeof AddReactionRequestSchema>) => {
        return commentsClient.addReaction(request);
    },

    /**
     * Remove a reaction from a comment.
     */
    removeReaction: async (request: MessageInitShape<typeof RemoveReactionRequestSchema>) => {
        return commentsClient.removeReaction(request);
    },

    /**
     * Get comment counts for multiple content items.
     */
    getCommentCounts: async (request: MessageInitShape<typeof GetCommentCountsRequestSchema>) => {
        return commentsClient.getCommentCounts(request);
    },
};
