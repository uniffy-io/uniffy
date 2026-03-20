import { useCallback, useEffect, useRef } from 'react';
import { ChatCircle, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { CommentInput } from '@/features/comments/components/CommentInput';
import { CommentThread } from '@/features/comments/components/CommentThread';
import { useComments, useCommentActions, useActiveComment } from '@/features/comments/hooks/useComments';
import { CommentAnchorType } from '@uniffy/proto/comments/v1/comments_pb';

interface CommentsPanelProps {
    contentType: number;
    contentId: string;
}

export function CommentsPanel({ contentType, contentId }: CommentsPanelProps) {
    const {
        comments,
        openCount,
        resolvedCount,
        loading,
        error,
        refresh,
    } = useComments(contentType, contentId);
    const { create } = useCommentActions();
    const { activeCommentId, showResolved, toggleResolved } = useActiveComment();
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Scroll to active comment when it changes
    useEffect(() => {
        if (activeCommentId && scrollContainerRef.current) {
            const el = scrollContainerRef.current.querySelector(`#comment-${activeCommentId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [activeCommentId]);

    const handleNewComment = useCallback(async (body: string) => {
        await create(contentType, contentId, body, CommentAnchorType.PAGE);
        refresh();
    }, [create, contentType, contentId, refresh]);

    const openComments = comments.filter(c => !c.isResolved);
    const resolvedComments = comments.filter(c => c.isResolved);

    return (
        <div className="flex flex-col h-full">
            {/* Header with toggle */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <button
                    onClick={() => toggleResolved(false)}
                    className={cn(
                        'text-xs px-2 py-1 rounded-md transition-colors',
                        !showResolved
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    Open ({openCount})
                </button>
                <button
                    onClick={() => toggleResolved(true)}
                    className={cn(
                        'text-xs px-2 py-1 rounded-md transition-colors',
                        showResolved
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    Resolved ({resolvedCount})
                </button>
            </div>

            {/* New comment input */}
            <div className="px-3 py-2 border-b border-border">
                <CommentInput
                    placeholder="Add a comment..."
                    onSubmit={handleNewComment}
                />
            </div>

            {/* Error banner */}
            {error && (
                <div className="flex items-center gap-2 px-3 py-2 border-b text-sm" style={{ borderColor: 'color-mix(in srgb, var(--status-error) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--status-error) 10%, transparent)', color: 'var(--status-error)' }}>
                    <WarningCircle size={14} className="shrink-0" />
                    <span className="truncate">{error}</span>
                    <button
                        onClick={refresh}
                        className="ml-auto shrink-0 text-xs underline hover:no-underline"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Comments list */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                ) : (
                    <>
                        {!showResolved ? (
                            openComments.length > 0 ? (
                                openComments.map((comment) => (
                                    <CommentThread
                                        key={comment.id}
                                        comment={comment}
                                        contentType={contentType}
                                        contentId={contentId}
                                        onRefresh={refresh}
                                    />
                                ))
                            ) : (
                                <EmptyState type="open" />
                            )
                        ) : (
                            resolvedComments.length > 0 ? (
                                resolvedComments.map((comment) => (
                                    <CommentThread
                                        key={comment.id}
                                        comment={comment}
                                        contentType={contentType}
                                        contentId={contentId}
                                        onRefresh={refresh}
                                    />
                                ))
                            ) : (
                                <EmptyState type="resolved" />
                            )
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function EmptyState({ type }: { type: 'open' | 'resolved' }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <ChatCircle size={32} className="text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
                {type === 'open'
                    ? 'No comments yet. Select text or add a page-level comment above.'
                    : 'No resolved comments.'}
            </p>
        </div>
    );
}
