/**
 * Reusable Search Results List Component
 *
 * Displays search results with keyboard navigation.
 * Can be used in global search, mention popups, etc.
 */

import { useState, useEffect } from 'react';
import {
  MagnifyingGlassIcon,
  DocumentTextIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  BookOpenIcon,
  CalendarIcon,
  KeyIcon,
  CubeIcon,
} from '@heroicons/react/24/outline';
import { SearchResultType } from '@/gen/search/v1/search_pb';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { cn } from '@/utils/cn';

/**
 * Get icon for search result type
 */
function getResultIcon(type: SearchResultType) {
  switch (type) {
    case SearchResultType.NOTE:
      return DocumentTextIcon;
    case SearchResultType.FILE:
      return FolderIcon;
    case SearchResultType.CHAT:
      return ChatBubbleLeftRightIcon;
    case SearchResultType.USER:
      return UserIcon;
    case SearchResultType.BOOK:
      return BookOpenIcon;
    case SearchResultType.CALENDAR_EVENT:
      return CalendarIcon;
    case SearchResultType.PASSWORD:
      return KeyIcon;
    case SearchResultType.SPACE:
      return CubeIcon;
    default:
      return DocumentTextIcon;
  }
}

/**
 * Get label for search result type
 */
function getResultTypeLabel(type: SearchResultType): string {
  switch (type) {
    case SearchResultType.NOTE:
      return 'Note';
    case SearchResultType.FILE:
      return 'File';
    case SearchResultType.CHAT:
      return 'Chat';
    case SearchResultType.USER:
      return 'User';
    case SearchResultType.BOOK:
      return 'Book';
    case SearchResultType.CALENDAR_EVENT:
      return 'Event';
    case SearchResultType.PASSWORD:
      return 'Password';
    case SearchResultType.SPACE:
      return 'Space';
    default:
      return 'Item';
  }
}

interface SearchResultsListProps {
  results: SearchResultItem[];
  isLoading: boolean;
  query?: string;
  onSelect: (result: SearchResultItem) => void;
  onClose?: () => void;
  className?: string;
  showFooter?: boolean;
  emptyMessage?: string;
}

export function SearchResultsList({
  results,
  isLoading,
  query = '',
  onSelect,
  onClose,
  className,
  showFooter = true,
  emptyMessage = 'No results found',
}: SearchResultsListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % results.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            onSelect(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, onSelect, onClose]);

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-background shadow-lg',
        'overflow-hidden',
        className
      )}
    >
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!isLoading && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <MagnifyingGlassIcon className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">{emptyMessage}</p>
          <p className="text-xs mt-1">Try a different search term</p>
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <>
          <ul className="py-2 max-h-80 overflow-auto">
            {results.map((result, index) => {
              const Icon = getResultIcon(result.type);
              return (
                <li key={result.urn}>
                  <button
                    onClick={() => onSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'w-full flex items-start gap-3 px-4 py-2.5 text-left',
                      'transition-colors duration-100',
                      index === selectedIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <Icon className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{result.title}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {getResultTypeLabel(result.type)}
                        </span>
                      </div>
                      {result.description && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {result.description}
                        </p>
                      )}
                    </div>
                    {result.score > 0 && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {Math.round(result.score * 100)}%
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Footer hint */}
          {showFooter && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground flex items-center gap-4">
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted">↑↓</kbd> to navigate
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted">↵</kbd> to select
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted">esc</kbd> to close
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
