import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { Plus } from "@phosphor-icons/react";

import { useAppDispatch } from "@/app/hooks";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { TagChip } from "@/features/tags/components/TagChip";
import { bulkUpsertTags, type SerializedTag } from "@/features/tags/store/tagsSlice";
import { useTagsByIds } from "@/features/tags/store/selectors";
import { createTagThunk, suggestTagsThunk } from "@/features/tags/store/tagsThunks";

const MAX_TAGS = 20;
const MIN_PREFIX = 2;
const DEBOUNCE_MS = 200;

export interface TagPickerHandle {
  commit: () => Promise<string[] | null>;
}

interface TagPickerProps {
  ref?: Ref<TagPickerHandle>;
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  onPendingChange?: (pending: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inlineSourcedTagIds?: ReadonlyArray<string>;
  autoFocus?: boolean;
}

export function TagPicker({
  ref,
  selectedTagIds,
  onChange,
  onPendingChange,
  placeholder = "Add tag...",
  disabled = false,
  className,
  inlineSourcedTagIds,
  autoFocus = false,
}: TagPickerProps) {
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SerializedTag[]>([]);
  const [isEditing, setIsEditing] = useState(autoFocus);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef(selectedTagIds);
  const pendingRef = useRef<Promise<string[] | null> | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    selectionRef.current = selectedTagIds;
  }, [selectedTagIds]);

  useEffect(() => {
    onPendingChange?.(query.trim().length >= MIN_PREFIX || isCreating);
  }, [query, isCreating, onPendingChange]);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const reachedCap = selectedTagIds.length >= MAX_TAGS;
  const isDisabled = disabled || isCreating;

  const selectedTags = useTagsByIds(selectedTagIds);

  const inlineOnlySet = useMemo(() => new Set(inlineSourcedTagIds ?? []), [inlineSourcedTagIds]);

  useEffect(() => {
    if (query.trim().length < MIN_PREFIX) {
      // Clearing suggestions on backspace keeps them aligned with the visible prefix.
      // eslint-disable-next-line react/react-compiler
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      const action = await dispatch(suggestTagsThunk({ prefix: query.trim(), limit: 10 }));
      if (suggestTagsThunk.fulfilled.match(action)) {
        setSuggestions(action.payload.filter((t) => !selectedTagIds.includes(t.id)));
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
    setQuery("");
    setSuggestions([]);
  }, []);

  const select = useCallback(
    (tag: SerializedTag, refocus = true) => {
      const currentIds = selectionRef.current;
      if (currentIds.includes(tag.id) || currentIds.length >= MAX_TAGS) return currentIds;
      const nextIds = [...currentIds, tag.id];
      selectionRef.current = nextIds;
      dispatch(bulkUpsertTags([tag]));
      onChange(nextIds);
      setQuery("");
      setSuggestions([]);
      if (refocus) window.setTimeout(() => inputRef.current?.focus(), 0);
      return nextIds;
    },
    [dispatch, onChange],
  );

  const remove = useCallback(
    (tagId: string) => {
      const nextIds = selectionRef.current.filter((id) => id !== tagId);
      selectionRef.current = nextIds;
      onChange(nextIds);
    },
    [onChange],
  );

  const createAndSelect = useCallback(
    (name: string, refocus = true): Promise<string[] | null> => {
      if (pendingRef.current) return pendingRef.current;
      const trimmed = name.trim();
      if (trimmed.length < MIN_PREFIX || selectionRef.current.length >= MAX_TAGS) {
        return Promise.resolve(selectionRef.current);
      }
      setIsCreating(true);
      const pending = dispatch(createTagThunk({ name: trimmed }))
        .then((action) => {
          if (!liveRef.current || !createTagThunk.fulfilled.match(action)) return null;
          return select(action.payload, refocus);
        })
        .finally(() => {
          pendingRef.current = null;
          if (liveRef.current) setIsCreating(false);
        });
      pendingRef.current = pending;
      return pending;
    },
    [dispatch, select],
  );

  const commit = useCallback((): Promise<string[] | null> => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (pendingRef.current) return pendingRef.current;
    const trimmed = query.trim();
    if (trimmed.length < MIN_PREFIX) return Promise.resolve(selectionRef.current);
    const exact = suggestions.find(
      (tag) =>
        tag.name.toLowerCase() === trimmed.toLowerCase() || tag.slug === trimmed.toLowerCase(),
    );
    return exact ? Promise.resolve(select(exact, false)) : createAndSelect(trimmed, false);
  }, [query, suggestions, select, createAndSelect]);

  useImperativeHandle(ref, () => ({ commit }), [commit]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      const exact = suggestions.find(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase() || t.slug === trimmed.toLowerCase(),
      );
      if (exact) {
        select(exact);
      } else if (trimmed.length >= MIN_PREFIX) {
        void createAndSelect(trimmed);
      }
    } else if (event.key === "Backspace" && !query && selectedTagIds.length > 0) {
      remove(selectedTagIds[selectedTagIds.length - 1]);
    } else if (event.key === "Escape") {
      stopEditing();
    }
  };

  const onBlur = () => {
    blurTimerRef.current = window.setTimeout(() => {
      blurTimerRef.current = null;
      void commit().then((ids) => {
        if (ids !== null && liveRef.current) stopEditing();
      });
    }, 150);
  };

  const showAddButton = !isDisabled && !isEditing && !reachedCap;
  const dropdownOpen = !isDisabled && isEditing && query.trim().length >= MIN_PREFIX;

  return (
    <div className={cn("relative", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {selectedTags.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            onRemove={isDisabled ? undefined : () => remove(tag.id)}
            removeDisabled={inlineOnlySet.has(tag.id)}
          />
        ))}

        {isEditing && (
          <input
            ref={inputRef}
            type="text"
            value={query}
            disabled={isDisabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            placeholder={placeholder}
            maxLength={32}
            className="focus-ring w-28 rounded-full bg-transparent px-2.5 py-0.5 text-xs text-foreground ring-1 ring-primary/40 placeholder:text-muted-foreground"
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
          <span className="text-[10px] text-muted-foreground">Max {MAX_TAGS}</span>
        )}
      </div>

      {dropdownOpen && (
        <div
          className={cn(
            popoverShellClass,
            "absolute left-0 z-20 mt-1 max-h-60 w-64 overflow-y-auto",
          )}
        >
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
                  <span className="ml-2 text-xs text-muted-foreground">{tag.usageCount}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
