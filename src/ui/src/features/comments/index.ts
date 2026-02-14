/**
 * Comments feature public API.
 *
 * Import from '@/features/comments' for all comment functionality.
 */

// Hooks
export { useComments, useCommentCount, useCommentActions, useActiveComment } from '@/features/comments/hooks/useComments';

// Store
export { clearComments, setActiveComment, commentsReducer } from '@/features/comments/store/commentsSlice';
export type { SerializedComment, SerializedReaction } from '@/features/comments/store/commentsSlice';
