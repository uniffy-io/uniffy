import { useState, useCallback } from 'react';
import { X, Smiley } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setCustomStatus,
    clearCustomStatusThunk,
} from '@/features/presence/store/presenceThunks';
import { useCustomStatus } from '@/features/presence/hooks/useCustomStatus';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { SelectOption } from '@/components/ui/select';
import { COMMON_EMOJIS } from '@/components/icon-picker';

interface CustomStatusPickerProps {
    onClose: () => void;
    className?: string;
}

interface StatusPreset {
    emoji: string;
    text: string;
}

const STATUS_PRESETS: StatusPreset[] = [
    { emoji: '\uD83D\uDCC5', text: 'In a meeting' },
    { emoji: '\uD83D\uDE8C', text: 'Commuting' },
    { emoji: '\uD83E\uDD12', text: 'Out sick' },
    { emoji: '\uD83C\uDFD6\uFE0F', text: 'Vacationing' },
    { emoji: '\uD83C\uDFE0', text: 'Working remotely' },
    { emoji: '\uD83C\uDF99\uFE0F', text: 'In a focus session' },
    { emoji: '\uD83C\uDF74', text: 'Lunch break' },
];

const DURATION_OPTIONS: SelectOption<string>[] = [
    { value: '', label: "Don't clear" },
    { value: '30', label: '30 minutes' },
    { value: '60', label: '1 hour' },
    { value: '240', label: '4 hours' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
];

function getExpiryDate(value: string): Date | undefined {
    if (!value) return undefined;
    const now = new Date();
    if (value === 'today') {
        const eod = new Date(now);
        eod.setHours(23, 59, 59, 999);
        return eod;
    }
    if (value === 'week') {
        const eow = new Date(now);
        const daysUntilSunday = 7 - eow.getDay();
        eow.setDate(eow.getDate() + daysUntilSunday);
        eow.setHours(23, 59, 59, 999);
        return eow;
    }
    const minutes = Number(value);
    if (minutes > 0) {
        return new Date(now.getTime() + minutes * 60 * 1000);
    }
    return undefined;
}

/**
 * Inline picker for setting a custom status.
 * Uses the shared emoji grid from icon-picker, shared Select
 * for duration, and shared Button for actions.
 */
export function CustomStatusPicker({
    onClose,
    className,
}: CustomStatusPickerProps) {
    const dispatch = useAppDispatch();
    const userId = useAppSelector((s) => s.auth.user?.id) ?? '';
    const currentStatus = useCustomStatus(userId);

    const [emoji, setEmoji] = useState(currentStatus?.emoji ?? '');
    const [text, setText] = useState(currentStatus?.text ?? '');
    const [duration, setDuration] = useState<string>('');
    const [showEmojiGrid, setShowEmojiGrid] = useState(false);

    const handleSave = useCallback(() => {
        if (!emoji && !text) return;
        dispatch(
            setCustomStatus({
                emoji,
                text,
                expiresAt: getExpiryDate(duration),
            }),
        );
        onClose();
    }, [dispatch, emoji, text, duration, onClose]);

    const handleClear = useCallback(() => {
        dispatch(clearCustomStatusThunk());
        onClose();
    }, [dispatch, onClose]);

    const handlePreset = useCallback((preset: StatusPreset) => {
        setEmoji(preset.emoji);
        setText(preset.text);
    }, []);

    return (
        <div
            className={cn(
                'w-80 bg-card border border-border rounded-xl shadow-lg p-4',
                className,
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-foreground">
                    Set a status
                </h3>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X size={16} />
                </Button>
            </div>

            {/* Input row */}
            <div className="flex items-center gap-2 mb-3">
                <button
                    className={cn(
                        'w-9 h-9 rounded-lg border border-border flex items-center justify-center',
                        'hover:bg-muted text-lg shrink-0 transition-colors',
                        showEmojiGrid && 'ring-2 ring-primary bg-muted',
                    )}
                    onClick={() => setShowEmojiGrid(!showEmojiGrid)}
                    title="Pick emoji"
                >
                    {emoji || <Smiley size={18} className="text-muted-foreground" />}
                </button>
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="What's your status?"
                    className={cn(
                        'flex-1 h-9 px-3 rounded-lg border border-border bg-input',
                        'text-sm text-foreground placeholder:text-muted-foreground',
                        'focus:outline-none focus:ring-2 focus:ring-ring',
                    )}
                    maxLength={100}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                    }}
                />
            </div>

            {/* Emoji grid - inline, uses shared COMMON_EMOJIS */}
            {showEmojiGrid && (
                <div className="mb-3 border border-border rounded-lg p-2 bg-muted/30">
                    <div className="grid grid-cols-8 gap-0.5">
                        {COMMON_EMOJIS.map((e) => (
                            <button
                                key={e}
                                onClick={() => {
                                    setEmoji(e);
                                    setShowEmojiGrid(false);
                                }}
                                className={cn(
                                    'p-1.5 rounded hover:bg-muted transition-colors text-base',
                                    emoji === e && 'bg-primary/10 ring-1 ring-primary',
                                )}
                            >
                                {e}
                            </button>
                        ))}
                    </div>
                    {emoji && (
                        <button
                            onClick={() => {
                                setEmoji('');
                                setShowEmojiGrid(false);
                            }}
                            className="mt-1.5 w-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md py-1 transition-colors"
                        >
                            Remove emoji
                        </button>
                    )}
                </div>
            )}

            {/* Duration - shared Select */}
            <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1 block">
                    Clear after
                </label>
                <Select
                    value={duration}
                    onChange={setDuration}
                    options={DURATION_OPTIONS}
                    placeholder="Don't clear"
                    size="sm"
                />
            </div>

            {/* Presets */}
            <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1 block">
                    Suggestions
                </label>
                <div className="space-y-0.5">
                    {STATUS_PRESETS.map((preset) => (
                        <button
                            key={preset.text}
                            onClick={() => handlePreset(preset)}
                            className={cn(
                                'w-full text-left px-2 py-1.5 rounded-md text-sm',
                                'hover:bg-muted text-foreground',
                                'flex items-center gap-2',
                            )}
                        >
                            <span>{preset.emoji}</span>
                            <span>{preset.text}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
                <Button
                    onClick={handleSave}
                    disabled={!emoji && !text}
                    size="sm"
                    className="flex-1"
                >
                    Save
                </Button>
                {currentStatus && (
                    <Button variant="outline" size="sm" onClick={handleClear}>
                        Clear
                    </Button>
                )}
            </div>
        </div>
    );
}
