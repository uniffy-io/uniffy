import { useState, useCallback } from 'react';
import { Plus } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import type { SerializedReaction } from '@/features/comments/store/commentsSlice';

const QUICK_REACTIONS = ['👍', '❤️', '😄', '😮', '😢', '🎉'];

interface CommentReactionsProps {
    reactions: SerializedReaction[];
    onReact: (emoji: string) => Promise<void>;
    onUnreact: (emoji: string) => Promise<void>;
}

export function CommentReactions({ reactions, onReact, onUnreact }: CommentReactionsProps) {
    const [showPicker, setShowPicker] = useState(false);

    const handleToggleReaction = useCallback(async (emoji: string, currentUserReacted: boolean) => {
        if (currentUserReacted) {
            await onUnreact(emoji);
        } else {
            await onReact(emoji);
        }
    }, [onReact, onUnreact]);

    const handleQuickReact = useCallback(async (emoji: string) => {
        setShowPicker(false);
        // Check if user already reacted with this emoji
        const existing = reactions.find(r => r.emoji === emoji);
        if (existing?.currentUserReacted) {
            await onUnreact(emoji);
        } else {
            await onReact(emoji);
        }
    }, [reactions, onReact, onUnreact]);

    if (reactions.length === 0 && !showPicker) {
        return (
            <button
                onClick={() => setShowPicker(true)}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                title="Add reaction"
            >
                <Plus size={14} />
            </button>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-1 mt-1">
            {reactions.map((reaction) => (
                <button
                    key={reaction.emoji}
                    onClick={() => handleToggleReaction(reaction.emoji, reaction.currentUserReacted)}
                    className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full',
                        'border transition-colors',
                        reaction.currentUserReacted
                            ? 'border-primary/50 bg-primary/10 text-foreground'
                            : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
                    )}
                    title={`${reaction.count} reaction${reaction.count !== 1 ? 's' : ''}`}
                >
                    <span>{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                </button>
            ))}
            <div className="relative">
                <button
                    onClick={() => setShowPicker(!showPicker)}
                    className={cn(
                        'inline-flex items-center justify-center w-6 h-6 rounded-full',
                        'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                    )}
                    title="Add reaction"
                >
                    <Plus size={14} />
                </button>
                {showPicker && (
                    <div className={cn(
                        'absolute bottom-full left-0 mb-1 z-10',
                        'flex gap-0.5 p-1 rounded-lg',
                        'bg-card border border-border shadow-md',
                    )}>
                        {QUICK_REACTIONS.map((emoji) => (
                            <button
                                key={emoji}
                                onClick={() => handleQuickReact(emoji)}
                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted transition-colors text-sm"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
