/** Async autocomplete via `SuggestTags` (debounced, min 2 chars), free-text creation, hard 20-tag cap matching the backend. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';

import { useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { TagChip } from '@/features/tags/components/TagChip';
import {
    bulkUpsertTags,
    type SerializedTag,
} from '@/features/tags/store/tagsSlice';
import { useTagsByIds } from '@/features/tags/store/selectors';
import {
    createTagThunk,
    suggestTagsThunk,
} from '@/features/tags/store/tagsThunks';

const MAX_TAGS = 20;
const MIN_PREFIX = 2;
const DEBOUNCE_MS = 200;

interface TagPickerProps {
    selectedTagIds: string[];
    onChange: (tagIds: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    inlineSourcedTagIds?: ReadonlyArray<string>;
    autoFocus?: boolean;
}

export function TagPicker({
    selectedTagIds,
    onChange,
    placeholder = 'Add tag...',
    disabled = false,
    className,
    inlineSourcedTagIds,
    autoFocus = false,
}: TagPickerProps) {
    const dispatch = useAppDispatch();
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<SerializedTag[]>([]);
    const [isEditing, setIsEditing] = useState(autoFocus);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus) {
            inputRef.current?.focus();
        }
    }, [autoFocus]);

    const reachedCap = selectedTagIds.length >= MAX_TAGS;

    const selectedTags = useTagsByIds(selectedTagIds);

    const inlineOnlySet = useMemo(
        () => new Set(inlineSourcedTagIds ?? []),
        [inlineSourcedTagIds]
    );

    useEffect(() => {
        if (query.trim().length < MIN_PREFIX) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the picker dropdown when the user backspaces below the prefix threshold is a deliberate reset
            setSuggestions([]);
            return;
        }
        const handle = window.setTimeout(async () => {
            const action = await dispatch(
                suggestTagsThunk({ prefix: query.trim(), limit: 10 })
            );
            if (suggestTagsThunk.fulfilled.match(action)) {
                setSuggestions(
                    action.payload.filter((t) => !selectedTagIds.includes(t.id))
                );
            }
        }, DEBOUNCE_MS);
        return () => window.clearTimeout(handle);
    }, [query, dispatch, selectedTagIds]);

    const startEditing = useCallback(() => {
        setIsEditing(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    const stopEditing = useCallback(() => {
        setIsEditing(false);
        setQuery('');
        setSuggestions([]);
    }, []);

    const select = useCallback(
        (tag: SerializedTag) => {
            if (selectedTagIds.includes(tag.id)) return;
            if (reachedCap) return;
            dispatch(bulkUpsertTags([tag]));
            onChange([...selectedTagIds, tag.id]);
            setQuery('');
            setSuggestions([]);
            window.setTimeout(() => inputRef.current?.focus(), 0);
        },
        [dispatch, onChange, reachedCap, selectedTagIds]
    );

    const remove = useCallback(
        (tagId: string) => {
            onChange(selectedTagIds.filter((id) => id !== tagId));
        },
        [onChange, selectedTagIds]
    );

    const createAndSelect = useCallback(
        async (name: string) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            const action = await dispatch(createTagThunk({ name: trimmed }));
            if (createTagThunk.fulfilled.match(action)) {
                select(action.payload);
            }
        },
        [dispatch, select]
    );

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const trimmed = query.trim();
            if (!trimmed) return;
            const exact = suggestions.find(
                (t) =>
                    t.name.toLowerCase() === trimmed.toLowerCase() ||
                    t.slug === trimmed.toLowerCase()
            );
            if (exact) {
                select(exact);
            } else if (trimmed.length >= MIN_PREFIX) {
                void createAndSelect(trimmed);
            }
        } else if (event.key === 'Backspace' && !query && selectedTagIds.length > 0) {
            remove(selectedTagIds[selectedTagIds.length - 1]);
        } else if (event.key === 'Escape') {
            stopEditing();
        }
    };

    const onBlur = () => {
        window.setTimeout(() => {
            const trimmed = query.trim();
            if (trimmed.length >= MIN_PREFIX) {
                void createAndSelect(trimmed);
            }
            stopEditing();
        }, 150);
    };

    const showAddButton = !disabled && !isEditing && !reachedCap;
    const dropdownOpen = isEditing && query.trim().length >= MIN_PREFIX;

    return (
        <div className={cn('relative', className)}>
            <div className="flex flex-wrap items-center gap-2">
                {selectedTags.map((tag) => (
                    <TagChip
                        key={tag.id}
                        tag={tag}
                        onRemove={disabled ? undefined : () => remove(tag.id)}
                        removeDisabled={inlineOnlySet.has(tag.id)}
                    />
                ))}

                {isEditing && (
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        onBlur={onBlur}
                        placeholder={placeholder}
                        maxLength={32}
                        className="w-28 rounded-full bg-transparent px-2.5 py-0.5 text-xs text-foreground outline-none ring-1 ring-primary/40 focus:ring-primary placeholder:text-muted-foreground"
                    />
                )}

                {showAddButton && (
                    <button
                        type="button"
                        onClick={startEditing}
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Add tag"
                        aria-label="Add tag"
                    >
                        <Plus size={14} weight="bold" />
                    </button>
                )}

                {reachedCap && !isEditing && (
                    <span className="text-[10px] text-muted-foreground">
                        Max {MAX_TAGS}
                    </span>
                )}
            </div>

            {dropdownOpen && (
                <div className="absolute left-0 z-20 mt-1 max-h-60 w-64 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                    {suggestions.length === 0 ? (
                        <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                void createAndSelect(query);
                            }}
                        >
                            Create tag &ldquo;{query.trim()}&rdquo;
                        </button>
                    ) : (
                        suggestions.map((tag) => (
                            <button
                                key={tag.id}
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    select(tag);
                                }}
                            >
                                <span className="truncate">#{tag.slug}</span>
                                {tag.usageCount > 0 && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {tag.usageCount}
                                    </span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
