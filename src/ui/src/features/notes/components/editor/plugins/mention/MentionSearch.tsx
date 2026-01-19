/**
 * Mention Search Component
 *
 * Displays a centered Spotlight-style search popup when "@" is typed.
 * Uses the same styling as SpotlightSearch for consistency.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import type { EditorView } from '@milkdown/kit/prose/view';
import { XMarkIcon, AtSymbolIcon } from '@heroicons/react/24/outline';
import { SearchResultsList, useSearch } from '@/features/search';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { cn } from '@/utils/cn';

interface MentionSearchProps {
  query: string;
  from: number;
  to: number;
  view: EditorView;
  onClose: () => void;
  onSelect: (result: SearchResultItem) => void;
  onQueryChange?: (query: string) => void;
}

export function MentionSearch({ query: initialQuery, from, view, onClose, onSelect, onQueryChange }: MentionSearchProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Manage query state locally to handle backspace properly
  const [localQuery, setLocalQuery] = useState(initialQuery);
  // Track previous query length for accurate replacement
  const prevQueryLengthRef = useRef(localQuery.length);

  // Search for all content types (no filters)
  const { setQuery, results, isLoading, query: currentSearchQuery, clearResults } = useSearch();

  // Update search query when local query changes
  const trimmedQuery = localQuery.trim();
  if (trimmedQuery !== currentSearchQuery) {
    setQuery(trimmedQuery);
  }

  // Sync editor content with local query
  const syncEditorContent = useCallback((newQuery: string, oldLength: number) => {
    const { state, dispatch } = view;
    // Replace content after @ with new query
    // from = position of @, so from+1 is where the query starts
    const queryStart = from + 1;
    const queryEnd = queryStart + oldLength;

    // Create fragment for replacement
    const fragment = newQuery
      ? state.schema.text(newQuery)
      : null;

    const tr = fragment
      ? state.tr.replaceWith(queryStart, queryEnd, fragment)
      : state.tr.delete(queryStart, queryEnd);

    dispatch(tr);
  }, [view, from]);

  // Handle input changes from the visible input
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    const oldLength = prevQueryLengthRef.current;

    setLocalQuery(newQuery);
    syncEditorContent(newQuery, oldLength);
    onQueryChange?.(newQuery);

    // Update ref for next change
    prevQueryLengthRef.current = newQuery.length;
  }, [syncEditorContent, onQueryChange]);

  // Handle special keys in the input
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle Escape - close popup and return focus to editor
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      view.focus();
      onClose();
      return;
    }

    // Handle Backspace on empty query - delete @ and close popup
    if (e.key === 'Backspace' && localQuery === '') {
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
  }, [view, from, localQuery, onClose]);

  // Handle clear button
  const handleClear = useCallback(() => {
    const oldLength = prevQueryLengthRef.current;
    setLocalQuery('');
    syncEditorContent('', oldLength);
    onQueryChange?.('');
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

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
          <div className="rounded-2xl border-2 border-primary/50 bg-card shadow-2xl ring-4 ring-primary/10 overflow-hidden">
            {/* Search input */}
            <div className="relative flex items-center border-b border-border/50">
              <div className="absolute left-4 flex items-center gap-1">
                <AtSymbolIcon className="h-5 w-5 text-primary" />
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
                  "focus:outline-none"
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
                    <XMarkIcon className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
                <kbd className="hidden sm:inline-flex px-2 py-1 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground font-mono">
                  esc
                </kbd>
              </div>
            </div>

            {/* Results or empty prompt */}
            {localQuery.trim() || isLoading ? (
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
                <p className="text-xs text-muted-foreground/60 mt-2">
                  Use <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 font-mono text-[10px]">@</kbd> to reference notes, files, users, and more
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
