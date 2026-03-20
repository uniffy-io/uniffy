import { useState, useCallback, useMemo } from 'react';
import { ArrowBendDownRight, Check, ArrowCounterClockwise, PencilSimple, Trash, Quotes } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { getInitials } from '@/components/subject/utils';
import { CommentInput } from '@/features/comments/components/CommentInput';
import { CommentReactions } from '@/features/comments/components/CommentReactions';
import type { SerializedComment } from '@/features/comments/store/commentsSlice';
import { CommentAnchorType } from '@uniffy/proto/comments/v1/comments_pb';
import { useCommentActions, useActiveComment } from '@/features/comments/hooks/useComments';
import { useAppSelector } from '@/app/hooks';

interface CommentThreadProps {
    comment: SerializedComment;
    contentType: number;
    contentId: string;
    onRefresh: () => void;
}

function AuthorAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
    const initials = getInitials(name);

    if (avatarUrl) {
        return (
            <img
                src={avatarUrl}
                alt={name}
                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
            />
        );
    }

    return (
        <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium flex-shrink-0">
            {initials}
        </div>
    );
}

function ReplyItem({
    reply,
    contentType,
    contentId,
    onRefresh,
}: {
    reply: SerializedComment;
    contentType: number;
    contentId: string;
    onRefresh: () => void;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const { update, remove, react, unreact } = useCommentActions();
    const currentUserId = useAppSelector((state) => state.auth.user?.id);
    const isAuthor = currentUserId === reply.authorId;

    const handleEdit = useCallback(async (body: string) => {
        await update(contentType, contentId, reply.id, body);
        setIsEditing(false);
        onRefresh();
    }, [update, contentType, contentId, reply.id, onRefresh]);

    const handleDelete = useCallback(async () => {
        await remove(contentType, contentId, reply.id);
        onRefresh();
    }, [remove, contentType, contentId, reply.id, onRefresh]);

    const handleReact = useCallback(async (emoji: string) => {
        await react(reply.id, emoji);
        onRefresh();
    }, [react, reply.id, onRefresh]);

    const handleUnreact = useCallback(async (emoji: string) => {
        await unreact(reply.id, emoji);
        onRefresh();
    }, [unreact, reply.id, onRefresh]);

    return (
        <div className="py-2 first:pt-0">
            <div className="flex items-center gap-2 mb-1">
                <AuthorAvatar name={reply.authorName} avatarUrl={reply.authorAvatarUrl || undefined} />
                <span className="text-sm font-medium">{reply.authorName}</span>
                <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(reply.createdAt)}
                </span>
                {reply.updatedAt && (
                    <span className="text-xs text-muted-foreground">(edited)</span>
                )}
            </div>
            {isEditing ? (
                <div className="ml-9">
                    <CommentInput
                        initialValue={reply.body}
                        onSubmit={handleEdit}
                        onCancel={() => setIsEditing(false)}
                        autoFocus
                    />
                </div>
            ) : (
                <div className="ml-9 text-sm whitespace-pre-wrap break-words">
                    {reply.body}
                </div>
            )}
            {/* Reactions */}
            <div className="ml-9 mt-1">
                <CommentReactions
                    reactions={reply.reactions}
                    onReact={handleReact}
                    onUnreact={handleUnreact}
                />
            </div>
            {/* Actions */}
            {!isEditing && isAuthor && (
                <div className="ml-9 mt-1 flex items-center gap-2">
                    <button
                        onClick={() => setIsEditing(true)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                        <PencilSimple size={12} />
                        Edit
                    </button>
                    <button
                        onClick={handleDelete}
                        className="text-xs text-muted-foreground hover-destructive flex items-center gap-1 transition-colors"
                    >
                        <Trash size={12} />
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
}

export function CommentThread({ comment, contentType, contentId, onRefresh }: CommentThreadProps) {
    const [showReplyInput, setShowReplyInput] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const { create, update, remove, resolve, reopen, react, unreact } = useCommentActions();
    const { activeCommentId, setActive } = useActiveComment();
    const currentUserId = useAppSelector((state) => state.auth.user?.id);
    const isActive = activeCommentId === comment.id;
    const isAuthor = currentUserId === comment.authorId;

    const anchorPreview = useMemo(() => {
        if (comment.anchorType === CommentAnchorType.SELECTION && comment.anchorData) {
            const text = (comment.anchorData as Record<string, unknown>).text as string | undefined;
            if (text) return text;
        }
        return null;
    }, [comment.anchorType, comment.anchorData]);

    const handleReply = useCallback(async (body: string) => {
        await create(contentType, contentId, body, undefined, undefined, comment.id);
        setShowReplyInput(false);
        onRefresh();
    }, [create, contentType, contentId, comment.id, onRefresh]);

    const handleEdit = useCallback(async (body: string) => {
        await update(contentType, contentId, comment.id, body);
        setIsEditing(false);
        onRefresh();
    }, [update, contentType, contentId, comment.id, onRefresh]);

    const handleDelete = useCallback(async () => {
        await remove(contentType, contentId, comment.id);
    }, [remove, contentType, contentId, comment.id]);

    const handleResolve = useCallback(async () => {
        await resolve(contentType, contentId, comment.id);
    }, [resolve, contentType, contentId, comment.id]);

    const handleReopen = useCallback(async () => {
        await reopen(contentType, contentId, comment.id);
    }, [reopen, contentType, contentId, comment.id]);

    const handleReact = useCallback(async (emoji: string) => {
        await react(comment.id, emoji);
        onRefresh();
    }, [react, comment.id, onRefresh]);

    const handleUnreact = useCallback(async (emoji: string) => {
        await unreact(comment.id, emoji);
        onRefresh();
    }, [unreact, comment.id, onRefresh]);

    const handleAnchorClick = useCallback(() => {
        setActive(comment.id);
    }, [setActive, comment.id]);

    return (
        <div
            className={cn(
                'border-b border-border last:border-b-0',
                'px-3 py-3 transition-colors',
                isActive && 'bg-primary/5',
                comment.isResolved && 'opacity-60',
            )}
            id={`comment-${comment.id}`}
        >
            {/* Anchor preview */}
            {anchorPreview && (
                <button
                    onClick={handleAnchorClick}
                    className={cn(
                        'flex items-start gap-1.5 mb-2 w-full text-left',
                        'text-xs text-muted-foreground hover:text-foreground transition-colors',
                    )}
                >
                    <Quotes size={12} className="mt-0.5 flex-shrink-0" />
                    <span className="italic line-clamp-2">{anchorPreview}</span>
                </button>
            )}

            {/* Comment header */}
            <div className="flex items-center gap-2 mb-1.5">
                <AuthorAvatar name={comment.authorName} avatarUrl={comment.authorAvatarUrl || undefined} />
                <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">{comment.authorName}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                        {formatRelativeTime(comment.createdAt)}
                    </span>
                    {comment.updatedAt && (
                        <span className="text-xs text-muted-foreground ml-1">(edited)</span>
                    )}
                </div>
            </div>

            {/* Comment body */}
            {isEditing ? (
                <div className="ml-9">
                    <CommentInput
                        initialValue={comment.body}
                        onSubmit={handleEdit}
                        onCancel={() => setIsEditing(false)}
                        autoFocus
                    />
                </div>
            ) : (
                <div className="ml-9 text-sm whitespace-pre-wrap break-words">
                    {comment.body}
                </div>
            )}

            {/* Reactions */}
            <div className="ml-9 mt-1">
                <CommentReactions
                    reactions={comment.reactions}
                    onReact={handleReact}
                    onUnreact={handleUnreact}
                />
            </div>

            {/* Actions */}
            {!isEditing && (
                <div className="ml-9 mt-2 flex items-center gap-2">
                    <button
                        onClick={() => setShowReplyInput(!showReplyInput)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                        <ArrowBendDownRight size={12} />
                        Reply{comment.replyCount > 0 ? ` (${comment.replyCount})` : ''}
                    </button>
                    {!comment.isResolved ? (
                        <button
                            onClick={handleResolve}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                            <Check size={12} />
                            Resolve
                        </button>
                    ) : (
                        <button
                            onClick={handleReopen}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                            <ArrowCounterClockwise size={12} />
                            Reopen
                        </button>
                    )}
                    {isAuthor && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                            <PencilSimple size={12} />
                            Edit
                        </button>
                    )}
                    {isAuthor && (
                        <button
                            onClick={handleDelete}
                            className="text-xs text-muted-foreground hover-destructive flex items-center gap-1 transition-colors"
                        >
                            <Trash size={12} />
                            Delete
                        </button>
                    )}
                </div>
            )}

            {/* Reply input */}
            {showReplyInput && (
                <div className="ml-9 mt-2">
                    <CommentInput
                        placeholder="Reply..."
                        onSubmit={handleReply}
                        onCancel={() => setShowReplyInput(false)}
                        autoFocus
                    />
                </div>
            )}

            {/* Nested replies */}
            {comment.replies.length > 0 && (
                <div className="ml-9 mt-2 border-l-2 border-border pl-3">
                    {comment.replies.map((reply) => (
                        <ReplyItem
                            key={reply.id}
                            reply={reply}
                            contentType={contentType}
                            contentId={contentId}
                            onRefresh={onRefresh}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
