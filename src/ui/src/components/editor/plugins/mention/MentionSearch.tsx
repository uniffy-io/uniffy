// Supports Google-style keyword filters: type prefixes (`note:`, `file:`, ...), `tag:`, and `my:` for the current user's content.
import { useRef, useEffect, useState, useCallback } from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import { X, At } from "@phosphor-icons/react";
import { dialogShellClass } from "@/components/ui/popover";
import { SearchResultsList, useSearch } from "@/features/search";
import { FilterChip } from "@/features/search/components/FilterChip";
import { FilterHints } from "@/features/search/components/FilterHints";
import {
  getTypeFilterLabel,
  removeTypeFilterFromQuery,
  removeTagFilterFromQuery,
  removeMyFilterFromQuery,
  removeProjectFilterFromQuery,
} from "@/features/search/utils/queryParser";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { cn } from "@/shared/utils/cn";

interface MentionSearchProps {
  query: string;
  from: number;
  to: number;
  view: EditorView;
  onClose: () => void;
  onSelect: (result: SearchResultItem) => void;
  onQueryChange?: (query: string) => void;
}

export function MentionSearch({
  query: initialQuery,
  from,
  view,
  onClose,
  onSelect,
  onQueryChange,
}: MentionSearchProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Manage query state locally to handle backspace properly
  const [localQuery, setLocalQuery] = useState(initialQuery);
  // Track previous query length for accurate replacement
  const prevQueryLengthRef = useRef(localQuery.length);

  // Search for all content types with filter support
  const {
    setQuery,
    results,
    isLoading,
    query: currentSearchQuery,
    clearResults,
    parsedQuery,
    hasFilters,
  } = useSearch();

  // Update search query when local query changes
  const trimmedQuery = localQuery.trim();
  if (trimmedQuery !== currentSearchQuery) {
    setQuery(trimmedQuery);
  }

  // Sync editor content with local query (defined first so other callbacks can use it)
  const syncEditorContent = useCallback(
    (newQuery: string, oldLength: number) => {
      const { state, dispatch } = view;
      // Replace content after @ with new query
      // from = position of @, so from+1 is where the query starts
      const queryStart = from + 1;
      const queryEnd = queryStart + oldLength;

      // Validate positions are within document bounds
      const docSize = state.doc.content.size;
      if (queryStart < 0 || queryEnd > docSize) return;

      // Create fragment for replacement
      const fragment = newQuery ? state.schema.text(newQuery) : null;

      const tr = fragment
        ? state.tr.replaceWith(queryStart, queryEnd, fragment)
        : state.tr.delete(queryStart, queryEnd);

      dispatch(tr);
    },
    [view, from],
  );

  // Filter removal handlers
  const handleRemoveTypeFilter = useCallback(
    (type: number) => {
      const newQuery = removeTypeFilterFromQuery(localQuery, type);
      setLocalQuery(newQuery);
      syncEditorContent(newQuery, prevQueryLengthRef.current);
      prevQueryLengthRef.current = newQuery.length;
    },
    [localQuery, syncEditorContent],
  );

  const handleRemoveTagFilter = useCallback(
    (tag: string) => {
      const newQuery = removeTagFilterFromQuery(localQuery, tag);
      setLocalQuery(newQuery);
      syncEditorContent(newQuery, prevQueryLengthRef.current);
      prevQueryLengthRef.current = newQuery.length;
    },
    [localQuery, syncEditorContent],
  );

  const handleRemoveProjectFilter = useCallback(
    (project: string) => {
      const newQuery = removeProjectFilterFromQuery(localQuery, project);
      setLocalQuery(newQuery);
      syncEditorContent(newQuery, prevQueryLengthRef.current);
      prevQueryLengthRef.current = newQuery.length;
    },
    [localQuery, syncEditorContent],
  );

  const handleRemoveMyFilter = useCallback(() => {
    const newQuery = removeMyFilterFromQuery(localQuery);
    setLocalQuery(newQuery);
    syncEditorContent(newQuery, prevQueryLengthRef.current);
    prevQueryLengthRef.current = newQuery.length;
  }, [localQuery, syncEditorContent]);

  const handleFilterHintClick = useCallback(
    (filter: string) => {
      const newQuery = filter + " ";
      setLocalQuery(newQuery);
      syncEditorContent(newQuery, prevQueryLengthRef.current);
      prevQueryLengthRef.current = newQuery.length;
      inputRef.current?.focus();
    },
    [syncEditorContent],
  );

  // Handle input changes from the visible input
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newQuery = e.target.value;
      const oldLength = prevQueryLengthRef.current;

      setLocalQuery(newQuery);
      syncEditorContent(newQuery, oldLength);
      onQueryChange?.(newQuery);

      // Update ref for next change
      prevQueryLengthRef.current = newQuery.length;
    },
    [syncEditorContent, onQueryChange],
  );

  // Handle special keys in the input
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Handle Escape - close popup and return focus to editor
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        view.focus();
        onClose();
        return;
      }

      // Handle Backspace on empty query - delete @ and close popup
      if (e.key === "Backspace" && localQuery === "") {
        e.preventDefault();
        e.stopPropagation();
        // Delete the @ symbol from the editor
        const { state, dispatch } = view;
        const tr = state.tr.delete(from, from + 1);
        dispatch(tr);
        view.focus();
        onClose();
        return;
      }

      // Let SearchResultsList handle arrow keys and Enter
      // These need to bubble to the document listener
    },
    [view, from, localQuery, onClose],
  );

  // Handle clear button
  const handleClear = useCallback(() => {
    const oldLength = prevQueryLengthRef.current;
    setLocalQuery("");
    syncEditorContent("", oldLength);
    onQueryChange?.("");
    prevQueryLengthRef.current = 0;
    clearResults();
    inputRef.current?.focus();
  }, [syncEditorContent, onQueryChange, clearResults]);

  // Focus the input when popup opens
  useEffect(() => {
    // Small delay to ensure the input is rendered
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  // Close on click outside (on the backdrop)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <>
      {/* Backdrop overlay - same as SpotlightSearch */}
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[999] animate-in fade-in-0 duration-150" />

      {/* Centered popup container - same as SpotlightSearch */}
      <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]">
        <div
          ref={popupRef}
          className="w-full max-w-2xl mx-4 animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200"
        >
          {/* Search input card - same styling as SpotlightSearch */}
          <div
            className={cn(dialogShellClass, "rounded-2xl ring-1 ring-primary/40 overflow-hidden")}
          >
            {/* Search input */}
            <div className="relative flex items-center border-b border-border/50">
              <div className="absolute left-4 flex items-center gap-1">
                <At size={20} weight="bold" className="text-primary" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={localQuery}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder="Search to mention..."
                className={cn(
                  "w-full h-14 bg-transparent pl-12 pr-20 text-lg",
                  "placeholder:text-subtle-foreground",
                  "focus:outline-none",
                )}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="absolute right-4 flex items-center gap-2">
                {localQuery && (
                  <button
                    onClick={handleClear}
                    className="p-1 rounded-md hover:bg-muted transition-colors"
                  >
                    <X size={16} weight="bold" className="text-muted-foreground" />
                  </button>
                )}
                <kbd className="hidden sm:inline-flex px-2 py-1 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground font-mono">
                  esc
                </kbd>
              </div>
            </div>

            {/* Active filters display */}
            {hasFilters && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/50 bg-muted/30">
                {parsedQuery.filters.types.map((type) => (
                  <FilterChip
                    key={`type-${type}`}
                    label={getTypeFilterLabel(type)}
                    onRemove={() => handleRemoveTypeFilter(type)}
                  />
                ))}
                {parsedQuery.filters.tags.map((tag) => (
                  <FilterChip
                    key={`tag-${tag}`}
                    label={`tag:${tag}`}
                    onRemove={() => handleRemoveTagFilter(tag)}
                  />
                ))}
                {parsedQuery.filters.projects.map((project) => (
                  <FilterChip
                    key={`project-${project}`}
                    label={`project:${project}`}
                    onRemove={() => handleRemoveProjectFilter(project)}
                  />
                ))}
                {parsedQuery.filters.myContentOnly && (
                  <FilterChip label="My content" onRemove={handleRemoveMyFilter} />
                )}
              </div>
            )}

            {/* Results or empty prompt */}
            {localQuery.trim() || isLoading || hasFilters ? (
              <SearchResultsList
                results={results}
                isLoading={isLoading}
                query={localQuery}
                onSelect={onSelect}
                onClose={onClose}
                className="border-0 shadow-none ring-0 rounded-none max-h-[60vh]"
                showHeader={false}
                showFooter={true}
                emptyMessage="No content found"
              />
            ) : (
              <div className="py-8 px-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Type to search for content to mention
                </p>
                <p className="text-xs text-subtle-foreground mt-2 mb-4">
                  Use{" "}
                  <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 font-mono text-[10px]">
                    @
                  </kbd>{" "}
                  to reference notes, files, users, and more
                </p>
                <FilterHints onHintClick={handleFilterHintClick} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
