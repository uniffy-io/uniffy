/**
 * Reusable Search Results List Component
 *
 * Displays search results with keyboard navigation.
 * Features glassmorphism and gradient styling matching MentionPreview.
 */

import { useState, useEffect, useRef } from 'react';
import { MagnifyingGlass, Tag } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { SearchResultType } from '@/gen/search/v1/search_pb';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { cn } from '@/shared/utils/cn';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { type UrnTypeTheme } from '@/config/theme/urnColors';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import { useThumbnailUrl } from '@/features/files/hooks/useThumbnail';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';

/** Avatar with error fallback for user search results */
function UserSearchAvatar({ userId, fallback }: { userId: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const avatarSrc = useAvatarUrl(userId, 'sm');
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={avatarSrc}
      alt=""
      className="w-8 h-8 rounded-full shrink-0 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/** Map SearchResultType to UrnType */
const SEARCH_RESULT_TYPE_TO_URN_TYPE: Record<number, UrnType> = {
  [SearchResultType.NOTE]: UrnType.NOTE,
  [SearchResultType.FILE]: UrnType.FILE,
  [SearchResultType.CHAT]: UrnType.CHAT,
  [SearchResultType.USER]: UrnType.USER,
  [SearchResultType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
  [SearchResultType.PROJECT]: UrnType.PROJECT,
  [SearchResultType.TASK]: UrnType.TASK,
  [SearchResultType.AGENT]: UrnType.AGENT,
  [SearchResultType.PROMPT]: UrnType.PROMPT,
};

interface ResultTheme extends UrnTypeTheme {
  icon: Icon;
  label: string;
}

/**
 * Get theme for search result type using centralized content type config
 */
function getResultTheme(type: SearchResultType): ResultTheme {
  const urnType = SEARCH_RESULT_TYPE_TO_URN_TYPE[type] || UrnType.UNKNOWN;
  const config = getContentTypeConfig(urnType);

  return {
    ...config.theme,
    icon: config.icon,
    label: config.label,
  };
}

/**
 * Thumbnail icon for FILE search results.
 * Falls back to the standard icon badge on error or missing thumbnail.
 */
function SearchFileIcon({ urn, isSelected, fallback }: {
    urn: string;
    isSelected: boolean;
    fallback: React.ReactNode;
}) {
    const { id: fileId } = parseUrn(urn);
    const { url } = useThumbnailUrl(fileId || null);
    const [error, setError] = useState(false);

    if (!url || error) return <>{fallback}</>;

    return (
        <img
            src={url}
            alt=""
            className={cn(
                'w-8 h-8 object-cover rounded-md shrink-0',
                isSelected ? 'ring-1 ring-white/20' : ''
            )}
            loading="lazy"
            onError={() => setError(true)}
        />
    );
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
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  // Use controlled index if provided, otherwise internal state
  const selectedIndex = controlledIndex ?? internalIndex;
  const setSelectedIndex = onSelectedIndexChange ?? setInternalIndex;

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, setSelectedIndex]);

  // Scroll selected item into view when navigating with keyboard
  const scrollToIndex = (index: number) => {
    const item = itemRefs.current.get(index);
    if (item) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  // Keyboard navigation (only arrow keys, enter, escape - copy handled by parent)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = (selectedIndex + 1) % results.length;
          setSelectedIndex(nextIndex);
          scrollToIndex(nextIndex);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = (selectedIndex - 1 + results.length) % results.length;
          setSelectedIndex(prevIndex);
          scrollToIndex(prevIndex);
          break;
        }
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
        'rounded-xl bg-card border border-border/80 shadow-xl',
        'overflow-hidden',
        'animate-in fade-in-0 slide-in-from-top-1 duration-200',
        className
      )}
    >
      {/* Header */}
      {showHeader && (
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <MagnifyingGlass size={14} weight="duotone" className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {query ? `"${query}"` : 'Search'}
            </span>
            {results.length > 0 && (
              <span className="text-[10px] text-muted-foreground/70 ml-auto">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <span className="text-sm text-muted-foreground">Searching...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <MagnifyingGlass size={20} weight="duotone" className="opacity-40 mb-2" />
          <p className="text-sm">{emptyMessage}</p>
          <p className="text-xs mt-0.5 opacity-60">Try a different search term</p>
        </div>
      )}

      {/* Results list */}
      {!isLoading && results.length > 0 && (
        <>
          <ul className="py-1.5 max-h-96 overflow-auto">
            {results.map((result, index) => {
              const theme = getResultTheme(result.type);
              const Icon = theme.icon;
              const isSelected = index === selectedIndex;

              return (
                <li
                  key={result.urn}
                  ref={(el) => {
                    if (el) {
                      itemRefs.current.set(index, el);
                    } else {
                      itemRefs.current.delete(index);
                    }
                  }}
                >
                  <button
                    onClick={() => onSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg text-left',
                      'transition-all duration-150 relative',
                      isSelected ? 'bg-muted/80' : 'hover:bg-muted/40'
                    )}
                    style={{ width: 'calc(100% - 12px)' }}
                  >
                    {/* Selection indicator */}
                    {isSelected && (
                      <div className={cn(
                        'absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full',
                        theme.iconBg
                      )} />
                    )}

                    {/* Icon badge / thumbnail / avatar */}
                    {result.type === SearchResultType.FILE ? (
                      <SearchFileIcon
                        urn={result.urn}
                        isSelected={isSelected}
                        fallback={
                          <div className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-md shrink-0',
                            'transition-all duration-200',
                            isSelected ? theme.iconBg : 'bg-muted'
                          )}>
                            <Icon size={16} weight={isSelected ? 'fill' : 'duotone'} className={cn(
                              isSelected ? 'text-white' : 'text-muted-foreground'
                            )} />
                          </div>
                        }
                      />
                    ) : result.type === SearchResultType.USER ? (
                      <UserSearchAvatar
                        userId={parseUrn(result.urn).id || ''}
                        fallback={
                          <div className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-md shrink-0',
                            'transition-all duration-200',
                            isSelected ? theme.iconBg : 'bg-muted'
                          )}>
                            <Icon size={16} weight={isSelected ? 'fill' : 'duotone'} className={cn(
                              isSelected ? 'text-white' : 'text-muted-foreground'
                            )} />
                          </div>
                        }
                      />
                    ) : (
                      <div className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-md shrink-0',
                        'transition-all duration-200',
                        isSelected ? theme.iconBg : 'bg-muted'
                      )}>
                        <Icon size={16} weight={isSelected ? 'fill' : 'duotone'} className={cn(
                          isSelected ? 'text-white' : 'text-muted-foreground'
                        )} />
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-sm font-medium truncate',
                          isSelected ? 'text-foreground' : 'text-foreground/80'
                        )}>
                          {result.title}
                        </span>
                        <span className={cn(
                          'text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded',
                          isSelected ? theme.badgeBg + ' ' + theme.accentText : 'text-muted-foreground/60'
                        )}>
                          {theme.label}
                        </span>
                      </div>
                      {/* Tags */}
                      {result.tags && result.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <Tag size={10} weight="duotone" className="text-muted-foreground/50 shrink-0" />
                          {result.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] text-muted-foreground/60"
                            >
                              {tag}
                            </span>
                          ))}
                          {result.tags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground/40">
                              +{result.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                      {result.description && (
                        <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                          {stripMarkdown(result.description)}
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
            <div className="border-t border-border/50 px-3 py-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono">↑↓</kbd>
                <span>navigate</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono">↵</kbd>
                <span>select</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono">⌘C</kbd>
                {copiedUrn ? (
                  <span style={{ color: 'var(--status-success)' }}>copied!</span>
                ) : (
                  <span>copy</span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono">esc</kbd>
                <span>close</span>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
