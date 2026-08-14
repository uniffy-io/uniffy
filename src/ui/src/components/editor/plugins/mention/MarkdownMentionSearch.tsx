import { useRef, useEffect, useState, useCallback } from "react";
import { X, At } from "@phosphor-icons/react";
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

interface MarkdownMentionSearchProps {
  initialQuery: string;
  onClose: () => void;
  onSelect: (result: SearchResultItem) => void;
}

/**
 * Spotlight-style mention picker for plain-text editors (CodeMirror).
 * Mirrors the prosemirror `MentionSearch` UX but owns its own query state
 * because there is no rich editor to sync back into - the caller replaces
 * the `@query` range with the chosen markdown chip on `onSelect`.
 */
export function MarkdownMentionSearch({
  initialQuery,
  onClose,
  onSelect,
}: MarkdownMentionSearchProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localQuery, setLocalQuery] = useState(initialQuery);

  const {
    setQuery,
    results,
    isLoading,
    query: currentSearchQuery,
    clearResults,
    parsedQuery,
    hasFilters,
  } = useSearch();

  const trimmedQuery = localQuery.trim();
  if (trimmedQuery !== currentSearchQuery) {
    setQuery(trimmedQuery);
  }

  const handleRemoveTypeFilter = useCallback((type: number) => {
    setLocalQuery((q) => removeTypeFilterFromQuery(q, type));
  }, []);

  const handleRemoveTagFilter = useCallback((tag: string) => {
    setLocalQuery((q) => removeTagFilterFromQuery(q, tag));
  }, []);

  const handleRemoveProjectFilter = useCallback((project: string) => {
    setLocalQuery((q) => removeProjectFilterFromQuery(q, project));
  }, []);

  const handleRemoveMyFilter = useCallback(() => {
    setLocalQuery((q) => removeMyFilterFromQuery(q));
  }, []);

  const handleFilterHintClick = useCallback((filter: string) => {
    setLocalQuery(filter + " ");
    inputRef.current?.focus();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQuery(e.target.value);
  }, []);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const handleClear = useCallback(() => {
    setLocalQuery("");
    clearResults();
    inputRef.current?.focus();
  }, [clearResults]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, []);

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
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[999] animate-in fade-in-0 duration-150" />
      <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]">
        <div
          ref={popupRef}
          className="w-full max-w-2xl mx-4 animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200"
        >
          <div className="rounded-2xl border-2 border-primary/50 bg-card shadow-2xl ring-4 ring-primary/10 overflow-hidden">
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
                  "placeholder:text-muted-foreground/60",
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
                <p className="text-xs text-muted-foreground/60 mt-2 mb-4">
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
