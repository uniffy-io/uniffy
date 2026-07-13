import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  CommentsService,
  CreateCommentRequestSchema,
  UpdateCommentRequestSchema,
  DeleteCommentRequestSchema,
  ListCommentsRequestSchema,
  ResolveCommentRequestSchema,
  ReopenCommentRequestSchema,
  AddReactionRequestSchema,
  RemoveReactionRequestSchema,
  GetCommentCountsRequestSchema,
} from "@uniffy/proto/comments/v1/comments_pb";
import { transport } from "@core/api/transport";

const client = createClient(CommentsService, transport);

export const commentsApi = {
  createComment: (req: MessageInitShape<typeof CreateCommentRequestSchema>) =>
    client.createComment(req),
  updateComment: (req: MessageInitShape<typeof UpdateCommentRequestSchema>) =>
    client.updateComment(req),
  deleteComment: (req: MessageInitShape<typeof DeleteCommentRequestSchema>) =>
    client.deleteComment(req),
  listComments: (req: MessageInitShape<typeof ListCommentsRequestSchema>) =>
    client.listComments(req),
  resolveComment: (req: MessageInitShape<typeof ResolveCommentRequestSchema>) =>
    client.resolveComment(req),
  reopenComment: (req: MessageInitShape<typeof ReopenCommentRequestSchema>) =>
    client.reopenComment(req),
  addReaction: (req: MessageInitShape<typeof AddReactionRequestSchema>) => client.addReaction(req),
  removeReaction: (req: MessageInitShape<typeof RemoveReactionRequestSchema>) =>
    client.removeReaction(req),
  getCommentCounts: (req: MessageInitShape<typeof GetCommentCountsRequestSchema>) =>
    client.getCommentCounts(req),
};
