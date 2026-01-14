/**
 * Mention Search Component
 *
 * Displays a search popup near the cursor when "@" is typed.
 * Uses the shared SearchResultsList component.
 */

import { useRef, useEffect } from 'react';
import type { EditorView } from '@milkdown/kit/prose/view';
import { SearchResultsList } from '@/features/search';
import { useSearch } from '@/features/search';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { SearchResultType } from '@/gen/search/v1/search_pb';
import { useAppSelector } from '@/app/hooks';

interface MentionSearchProps {
  query: string;
  from: number;
  to: number;
  view: EditorView;
  onClose: () => void;
  onSelect: (result: SearchResultItem) => void;
}

export function MentionSearch({ query, from, to, view, onClose, onSelect }: MentionSearchProps) {
  console.log('[MentionSearch] Component rendered with props:', { query, from, to });

  const popupRef = useRef<HTMLDivElement>(null);

  // Check if user is logged in and has an organization
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  console.log('[MentionSearch] Organization ID:', organizationId);

  // Search for all content types (no filters)
  const { setQuery, results, isLoading, error, query: currentSearchQuery } = useSearch();

  console.log('[MentionSearch] useSearch returned:', { results, isLoading, error, resultsLength: results.length, currentSearchQuery });

  // Update search query - call directly when query prop changes
  const trimmedQuery = query.trim();
  if (trimmedQuery !== currentSearchQuery) {
    console.log('[MentionSearch] Query mismatch - updating:', { trimmedQuery, currentSearchQuery });
    setQuery(trimmedQuery);
  }

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Get position from the cursor
  const coords = view.coordsAtPos(from);
  const style = {
    position: 'fixed' as const,
    left: `${coords.left}px`,
    top: `${coords.bottom + 4}px`,
    zIndex: 1000,
  };

  return (
    <div ref={popupRef} style={style} className="mention-popup">
      <SearchResultsList
        results={results}
        isLoading={isLoading}
        query={query}
        onSelect={onSelect}
        onClose={onClose}
        className="w-96"
        emptyMessage="No notes or files found"
      />
    </div>
  );
}
