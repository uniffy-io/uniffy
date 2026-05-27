import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { CommentsService, AddReactionRequestSchema, CreateCommentRequestSchema, DeleteCommentRequestSchema, GetCommentCountsRequestSchema, GetCommentRequestSchema, ListCommentsRequestSchema, RemoveReactionRequestSchema, ReopenCommentRequestSchema, ResolveCommentRequestSchema, UpdateCommentRequestSchema } from '@uniffy/proto/comments/v1/comments_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const commentsClient = createClient(CommentsService, unaryTransport);

export const commentsApi = {
    createComment: async (request: MessageInitShape<typeof CreateCommentRequestSchema>) => {
        return commentsClient.createComment(request);
    },

    updateComment: async (request: MessageInitShape<typeof UpdateCommentRequestSchema>) => {
        return commentsClient.updateComment(request);
    },

    deleteComment: async (request: MessageInitShape<typeof DeleteCommentRequestSchema>) => {
        return commentsClient.deleteComment(request);
    },

    listComments: async (request: MessageInitShape<typeof ListCommentsRequestSchema>) => {
        return commentsClient.listComments(request);
    },

    getComment: async (request: MessageInitShape<typeof GetCommentRequestSchema>) => {
        return commentsClient.getComment(request);
    },

    resolveComment: async (request: MessageInitShape<typeof ResolveCommentRequestSchema>) => {
        return commentsClient.resolveComment(request);
    },

    reopenComment: async (request: MessageInitShape<typeof ReopenCommentRequestSchema>) => {
        return commentsClient.reopenComment(request);
    },

    addReaction: async (request: MessageInitShape<typeof AddReactionRequestSchema>) => {
        return commentsClient.addReaction(request);
    },

    removeReaction: async (request: MessageInitShape<typeof RemoveReactionRequestSchema>) => {
        return commentsClient.removeReaction(request);
    },

    getCommentCounts: async (request: MessageInitShape<typeof GetCommentCountsRequestSchema>) => {
        return commentsClient.getCommentCounts(request);
    },
};
