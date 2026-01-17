/**
 * Mention Search Component
 *
 * Displays a centered Spotlight-style search popup when "@" is typed.
 * Uses the shared SearchResultsList component.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import type { EditorView } from '@milkdown/kit/prose/view';
import { SearchResultsList, useSearch } from '@/features/search';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';

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

  // Search for all content types (no filters)
  const { setQuery, results, isLoading, query: currentSearchQuery } = useSearch();

  // Update search query when local query changes
  const trimmedQuery = localQuery.trim();
  if (trimmedQuery !== currentSearchQuery) {
    setQuery(trimmedQuery);
  }

  // Track previous query length for accurate replacement
  const prevQueryLengthRef = useRef(localQuery.length);

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

  // Handle input changes from the hidden input
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

  // Focus the hidden input when popup opens
  useEffect(() => {
    // Small delay to ensure the input is rendered
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  // Update local query if initial query changes (e.g., from continued typing before popup fully initialized)
  useEffect(() => {
    if (initialQuery !== localQuery && initialQuery.length > localQuery.length) {
      setLocalQuery(initialQuery);
      prevQueryLengthRef.current = initialQuery.length;
    }
  }, [initialQuery, localQuery]);

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
      {/* Backdrop overlay */}
      <div className="fixed inset-0 bg-background/50 z-[999] animate-in fade-in-0 duration-150" />

      {/* Hidden input to capture keyboard input */}
      <input
        ref={inputRef}
        type="text"
        value={localQuery}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        className="sr-only"
        aria-label="Search mentions"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />

      {/* Centered popup container */}
      <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]">
        <div ref={popupRef} className="mention-popup w-full max-w-2xl mx-4">
          <SearchResultsList
            results={results}
            isLoading={isLoading}
            query={localQuery}
            onSelect={onSelect}
            onClose={onClose}
            emptyMessage="No notes or files found"
          />
        </div>
      </div>
    </>
  );
}
