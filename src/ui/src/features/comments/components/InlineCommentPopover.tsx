import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';
import { CommentAnchorType } from '@/gen/comments/v1/comments_pb';
import { useCommentActions } from '@/features/comments/hooks/useComments';
import { Struct } from '@bufbuild/protobuf';

interface InlineCommentPopoverProps {
    selection: {
        from: number;
        to: number;
        text: string;
        rect: DOMRect;
    };
    contentType: number;
    contentId: string;
    onClose: () => void;
    onCommentCreated?: () => void;
}

export function InlineCommentPopover({
    selection,
    contentType,
    contentId,
    onClose,
    onCommentCreated,
}: InlineCommentPopoverProps) {
    const [body, setBody] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { create } = useCommentActions();
    const popoverRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Position the popover above the selection
    const top = selection.rect.top - 8 + window.scrollY;
    const left = selection.rect.left + selection.rect.width / 2;

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const handleSubmit = useCallback(async () => {
        if (!body.trim() || isSubmitting) return;

        setIsSubmitting(true);
        try {
            const anchorData = new Struct();
            anchorData.fromJson({
                from: selection.from,
                to: selection.to,
                text: selection.text,
            });

            await create(
                contentType,
                contentId,
                body.trim(),
                CommentAnchorType.SELECTION,
                anchorData,
            );
            onCommentCreated?.();
            onClose();
        } catch (error) {
            console.error('Failed to create comment:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [body, isSubmitting, create, contentType, contentId, selection, onClose, onCommentCreated]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [handleSubmit, onClose]);

    return createPortal(
        <div
            ref={popoverRef}
            className={cn(
                'fixed z-50 transform -translate-x-1/2 -translate-y-full',
                'bg-card text-card-foreground border border-border rounded-lg shadow-lg',
            )}
            style={{ top, left }}
        >
            <div className="p-3 w-72">
                <div className="text-xs text-muted-foreground mb-2 line-clamp-1 italic">
                    &quot;{selection.text}&quot;
                </div>
                <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add a comment..."
                    rows={3}
                    className={cn(
                        'w-full resize-none rounded-md border border-border bg-background',
                        'px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring',
                    )}
                />
                <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">
                        Ctrl+Enter to submit
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!body.trim() || isSubmitting}
                            className={cn(
                                'px-3 py-1 text-xs rounded-md',
                                'bg-primary text-primary-foreground',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                            )}
                        >
                            {isSubmitting ? 'Posting...' : 'Comment'}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
