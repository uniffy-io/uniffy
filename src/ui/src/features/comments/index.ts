export { useComments, useCommentCount, useCommentActions, useActiveComment } from '@/features/comments/hooks/useComments';

export { clearComments, setActiveComment, commentsReducer } from '@/features/comments/store/commentsSlice';
export type { SerializedComment, SerializedReaction } from '@/features/comments/store/commentsSlice';
