/**
 * Reusable Search Results List Component
 *
 * Displays search results with keyboard navigation.
 * Features glassmorphism and gradient styling matching MentionPreview.
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
import { UrnType } from '@/utils/urn';
import { getUrnTypeTheme, type UrnTypeTheme } from '@/theme/urnColors';

/** Icon mapping for search result types */
const RESULT_TYPE_ICONS: Record<number, typeof DocumentTextIcon> = {
  [SearchResultType.NOTE]: DocumentTextIcon,
  [SearchResultType.FILE]: FolderIcon,
  [SearchResultType.CHAT]: ChatBubbleLeftRightIcon,
  [SearchResultType.USER]: UserIcon,
  [SearchResultType.BOOK]: BookOpenIcon,
  [SearchResultType.CALENDAR_EVENT]: CalendarIcon,
  [SearchResultType.PASSWORD]: KeyIcon,
  [SearchResultType.SPACE]: CubeIcon,
};

/** Map SearchResultType to UrnType for theme lookup */
const RESULT_TYPE_TO_URN_TYPE: Record<number, UrnType> = {
  [SearchResultType.NOTE]: UrnType.NOTE,
  [SearchResultType.FILE]: UrnType.FILE,
  [SearchResultType.CHAT]: UrnType.CHAT,
  [SearchResultType.USER]: UrnType.USER,
  [SearchResultType.BOOK]: UrnType.BOOK,
  [SearchResultType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
  [SearchResultType.PASSWORD]: UrnType.PASSWORD,
  [SearchResultType.SPACE]: UrnType.SPACE,
};

interface ResultTheme extends UrnTypeTheme {
  icon: typeof DocumentTextIcon;
}

/**
 * Get theme for search result type
 */
function getResultTheme(type: SearchResultType): ResultTheme {
  const urnType = RESULT_TYPE_TO_URN_TYPE[type] || UrnType.UNKNOWN;
  const theme = getUrnTypeTheme(urnType);
  const icon = RESULT_TYPE_ICONS[type] || DocumentTextIcon;

  return {
    ...theme,
    icon,
  };
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
  showHeader?: boolean;
  showFooter?: boolean;
  emptyMessage?: string;
  /** Controlled selected index */
  selectedIndex?: number;
  /** Callback when selected index changes */
  onSelectedIndexChange?: (index: number) => void;
  /** Whether URN was just copied (for feedback) */
  copiedUrn?: boolean;
}

export function SearchResultsList({
  results,
  isLoading,
  query = '',
  onSelect,
  onClose,
  className,
  showHeader = true,
  showFooter = true,
  emptyMessage = 'No results found',
  selectedIndex: controlledIndex,
  onSelectedIndexChange,
  copiedUrn = false,
}: SearchResultsListProps) {
  const [internalIndex, setInternalIndex] = useState(0);

  // Use controlled index if provided, otherwise internal state
  const selectedIndex = controlledIndex ?? internalIndex;
  const setSelectedIndex = onSelectedIndexChange ?? setInternalIndex;

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, setSelectedIndex]);

  // Keyboard navigation (only arrow keys, enter, escape - copy handled by parent)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev: number) => (prev + 1) % results.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev: number) => (prev - 1 + results.length) % results.length);
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
  }, [results, selectedIndex, onSelect, onClose, setSelectedIndex]);

  return (
    <div
      className={cn(
        'rounded-2xl border-2 border-primary/50 bg-card shadow-2xl',
        'ring-4 ring-primary/10',
        'overflow-hidden',
        'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200',
        className
      )}
    >
      {/* Header */}
      {showHeader && (
        <div className="px-4 py-3 border-b border-border/50 bg-gradient-to-r from-muted/50 to-transparent">
          <div className="flex items-center gap-2">
            <MagnifyingGlassIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {query ? `Search: "${query}"` : 'Search'}
            </span>
            {results.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <span className="text-sm text-muted-foreground">Searching...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <MagnifyingGlassIcon className="w-6 h-6 opacity-50" />
          </div>
          <p className="text-sm font-medium">{emptyMessage}</p>
          <p className="text-xs mt-1 opacity-70">Try a different search term</p>
        </div>
      )}

      {/* Results list */}
      {!isLoading && results.length > 0 && (
        <>
          <ul className="py-2 max-h-80 overflow-auto">
            {results.map((result, index) => {
              const theme = getResultTheme(result.type);
              const Icon = theme.icon;
              const isSelected = index === selectedIndex;

              return (
                <li key={result.urn}>
                  <button
                    onClick={() => onSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left',
                      'transition-all duration-150 relative',
                      isSelected && 'bg-gradient-to-r ' + theme.gradient
                    )}
                  >
                    {/* Selection indicator */}
                    {isSelected && (
                      <div className={cn(
                        'absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full',
                        theme.iconBg
                      )} />
                    )}

                    {/* Icon badge */}
                    <div className={cn(
                      'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
                      'transition-all duration-200',
                      isSelected ? theme.iconBg + ' shadow-md' : 'bg-muted'
                    )}>
                      <Icon className={cn(
                        'w-4.5 h-4.5',
                        isSelected ? 'text-white' : 'text-muted-foreground'
                      )} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'font-medium truncate',
                          isSelected ? 'text-foreground' : 'text-foreground/90'
                        )}>
                          {result.title}
                        </span>
                        <span className={cn(
                          'text-xs font-medium shrink-0',
                          isSelected ? theme.accentText : 'text-muted-foreground'
                        )}>
                          {getResultTypeLabel(result.type)}
                        </span>
                      </div>
                      {result.description && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {result.description}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Footer hint */}
          {showFooter && (
            <div className="border-t border-border/50 px-4 py-2.5 bg-muted/30 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded-md bg-card border border-border/50 font-mono text-[10px]">↑↓</kbd>
                <span>navigate</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded-md bg-card border border-border/50 font-mono text-[10px]">↵</kbd>
                <span>select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded-md bg-card border border-border/50 font-mono text-[10px]">⌘C</kbd>
                {copiedUrn ? (
                  <span className="text-green-600 dark:text-green-400">copied!</span>
                ) : (
                  <span>copy URN</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded-md bg-card border border-border/50 font-mono text-[10px]">esc</kbd>
                <span>close</span>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
