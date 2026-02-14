import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CircleNotch } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { CommentThread } from '@/features/comments/components/CommentThread';
import { serializeComment } from '@/features/comments/store/commentsSlice';
import type { SerializedComment } from '@/features/comments/store/commentsSlice';
import { commentsApi } from '@/features/comments/api/commentsApi';
import { useAppSelector } from '@/app/hooks';

interface CommentThreadPopoverProps {
    comment: SerializedComment;
    contentType: number;
    contentId: string;
    anchorRect: DOMRect;
    onClose: () => void;
    onRefresh: () => void;
}

export function CommentThreadPopover({
    comment,
    contentType,
    contentId,
    anchorRect,
    onClose,
    onRefresh,
}: CommentThreadPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const [fullComment, setFullComment] = useState<SerializedComment>(comment);
    const [loading, setLoading] = useState(true);

    // Fetch the full comment with replies
    const fetchFullComment = useCallback(async () => {
        if (!organizationId) return;
        try {
            const response = await commentsApi.getComment({
                organizationId,
                commentId: comment.id,
            });
            if (response.comment) {
                setFullComment(serializeComment(response.comment));
            }
        } catch {
            // Fall back to the comment from list (no replies)
        } finally {
            setLoading(false);
        }
    }, [organizationId, comment.id]);

    // Fetch on mount
    useEffect(() => {
        fetchFullComment();
    }, [fetchFullComment]);

    // Position: below the highlight, centered horizontally
    const top = anchorRect.bottom + 8 + window.scrollY;
    const left = Math.max(16, anchorRect.left + anchorRect.width / 2);

    // Close on outside click
    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Delay attaching to avoid the opening click from immediately closing
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleMouseDown);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [onClose]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleRefresh = useCallback(() => {
        onRefresh();
        fetchFullComment();
    }, [onRefresh, fetchFullComment]);

    return createPortal(
        <div
            ref={popoverRef}
            className={cn(
                'fixed z-50 transform -translate-x-1/2',
                'bg-card text-card-foreground border border-border rounded-lg shadow-xl',
                'w-80 max-h-96 overflow-y-auto',
                'animate-in fade-in-0 zoom-in-95 duration-150',
            )}
            style={{ top, left }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground">
                    Comment Thread
                </span>
                <button
                    onClick={onClose}
                    className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Comment thread */}
            {loading ? (
                <div className="flex items-center justify-center py-6">
                    <CircleNotch size={20} className="animate-spin text-muted-foreground" />
                </div>
            ) : (
                <CommentThread
                    comment={fullComment}
                    contentType={contentType}
                    contentId={contentId}
                    onRefresh={handleRefresh}
                />
            )}
        </div>,
        document.body,
    );
}
