import { useState, useEffect, useRef } from 'react';
import { MagnifyingGlass, Tag, Hash, ChatCircle, Folder, PresentationChart } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';
import { cn } from '@/shared/utils/cn';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { type UrnTypeTheme } from '@/config/theme/urnColors';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import { hasHighlight, renderHighlightedText } from '@/features/search/utils/highlight';
import { useThumbnailUrl } from '@/features/files/hooks/useThumbnail';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { SUBJECT_TYPE } from '@/components/subject/types';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';

/** SearchResultType to UrnType. Update when adding a new content type. */
const SEARCH_RESULT_TYPE_TO_URN_TYPE: Record<number, UrnType> = {
  [SearchResultType.NOTE]: UrnType.NOTE,
  [SearchResultType.FILE]: UrnType.FILE,
  [SearchResultType.FOLDER]: UrnType.FOLDER,
  [SearchResultType.CHAT]: UrnType.CHAT,
  [SearchResultType.AGENT_CHAT]: UrnType.AGENT_CHAT,
  [SearchResultType.AGENT_FOLDER]: UrnType.AGENT_FOLDER,
  [SearchResultType.CHAT_MESSAGE]: UrnType.CHAT_MESSAGE,
  [SearchResultType.USER]: UrnType.USER,
  [SearchResultType.TEAM]: UrnType.TEAM,
  [SearchResultType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
  [SearchResultType.PROJECT]: UrnType.PROJECT,
  [SearchResultType.TASK]: UrnType.TASK,
  [SearchResultType.AGENT]: UrnType.AGENT,
  [SearchResultType.ROOM]: UrnType.ROOM,
  [SearchResultType.TAG]: UrnType.TAG,
};

interface ResultTheme extends UrnTypeTheme {
  icon: Icon;
  label: string;
}

function getResultTheme(result: SearchResultItem): ResultTheme {
  const urnType = SEARCH_RESULT_TYPE_TO_URN_TYPE[result.type] || UrnType.UNKNOWN;
  const config = getContentTypeConfig(urnType);

  // Notes-tree folders and canvases index as NOTE; the node_type metadata
  // distinguishes them so the badge does not claim "Note".
  if (result.type === SearchResultType.NOTE) {
    const nodeType = result.metadata['node_type'];
    if (nodeType === 'FOLDER') {
      return { ...config.theme, icon: Folder, label: 'Folder' };
    }
    if (nodeType === 'CANVAS') {
      return { ...config.theme, icon: PresentationChart, label: 'Canvas' };
    }
  }

  return {
    ...config.theme,
    icon: config.icon,
    label: config.label,
  };
}

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
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  copiedUrn?: boolean;
  /** Estimated total matches before pagination; shows "N of M" when it exceeds the page. */
  totalCount?: number;
}

function resultCountLabel(shown: number, totalCount?: number): string {
  if (totalCount !== undefined && totalCount > shown) {
    return `${shown} of ${totalCount} results`;
  }
  return `${shown} result${shown !== 1 ? 's' : ''}`;
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
  totalCount,
}: SearchResultsListProps) {
  const [internalIndex, setInternalIndex] = useState(0);
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const selectedIndex = controlledIndex ?? internalIndex;
  const setSelectedIndex = onSelectedIndexChange ?? setInternalIndex;

  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, setSelectedIndex]);

  const scrollToIndex = (index: number) => {
    const item = itemRefs.current.get(index);
    if (item) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

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
      {showHeader && (
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <MagnifyingGlass size={14} weight="duotone" className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {query ? `"${query}"` : 'Search'}
            </span>
            {results.length > 0 && (
              <span className="text-[10px] text-muted-foreground/70 ml-auto">
                {resultCountLabel(results.length, totalCount)}
              </span>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <span className="text-sm text-muted-foreground">Searching...</span>
          </div>
        </div>
      )}

      {!isLoading && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <MagnifyingGlass size={20} weight="duotone" className="opacity-40 mb-2" />
          <p className="text-sm">{emptyMessage}</p>
          <p className="text-xs mt-0.5 opacity-60">Try a different search term</p>
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <>
          <ul className="py-1.5 max-h-96 overflow-auto">
            {results.map((result, index) => {
              const theme = getResultTheme(result);
              const Icon = theme.icon;
              const isSelected = index === selectedIndex;
              const description = result.description ? stripMarkdown(result.description) : '';
              // Chat messages index their content as both title and description;
              // the duplicate line is noise unless the crop adds context.
              const showDescription = !!description && description !== result.title;
              const personRole = result.type === SearchResultType.USER
                ? [result.metadata['job_title'], result.metadata['department']]
                    .filter(Boolean)
                    .join(' · ')
                : result.type === SearchResultType.TEAM
                  ? [
                      result.metadata['member_count']
                        ? `${result.metadata['member_count']} member${result.metadata['member_count'] === '1' ? '' : 's'}`
                        : '',
                      result.metadata['parent_label'],
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : '';

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
                      isSelected ? cn('bg-muted/80', theme.glow) : 'hover:bg-muted/40'
                    )}
                    style={{ width: 'calc(100% - 12px)' }}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full bg-primary" />
                    )}

                    {result.type === SearchResultType.FILE ? (
                      <SearchFileIcon
                        urn={result.urn}
                        isSelected={isSelected}
                        fallback={
                          <div className={cn(
                            'grid place-items-center w-8 h-8 rounded-md shrink-0 transition-all duration-200',
                            isSelected ? theme.iconBoxAccent : 'bg-muted text-muted-foreground'
                          )}>
                            <Icon size={16} weight={isSelected ? 'fill' : 'duotone'} />
                          </div>
                        }
                      />
                    ) : result.type === SearchResultType.USER ? (
                      <SubjectAvatar
                        subject={{
                          id: parseUrn(result.urn).id || '',
                          type: SUBJECT_TYPE.USER,
                          name: result.title,
                        }}
                        size="md"
                        className="shrink-0"
                      />
                    ) : result.type === SearchResultType.AGENT
                      || result.type === SearchResultType.AGENT_CHAT ? (
                      <AgentAvatar
                        agentName={result.metadata['agent_name'] || result.title}
                        avatarEmoji={result.metadata['emoji']}
                        size="md"
                      />
                    ) : (
                      <div className={cn(
                        'grid place-items-center w-8 h-8 rounded-md shrink-0 transition-all duration-200',
                        isSelected ? theme.iconBoxAccent : 'bg-muted text-muted-foreground'
                      )}>
                        <Icon size={16} weight={isSelected ? 'fill' : 'duotone'} />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-sm font-medium truncate',
                          isSelected ? 'text-foreground' : 'text-foreground/80'
                        )}>
                          {hasHighlight(result.titleHighlighted)
                            ? renderHighlightedText(result.titleHighlighted)
                            : result.title}
                        </span>
                        {personRole && (
                          <span className="text-xs text-muted-foreground/70 truncate min-w-0">
                            {personRole}
                          </span>
                        )}
                        <span className={cn(
                          'text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded',
                          isSelected ? theme.badgeBg + ' ' + theme.accentText : 'text-muted-foreground/60'
                        )}>
                          {theme.label}
                        </span>
                      </div>
                      {result.type === SearchResultType.CHAT_MESSAGE && result.metadata['channel_name'] && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {result.metadata['channel_type'] === 'PUBLIC' || result.metadata['channel_type'] === 'PRIVATE' ? (
                            <Hash size={11} weight="bold" className="text-violet-400 shrink-0" />
                          ) : (
                            <ChatCircle size={11} weight="fill" className="text-violet-400 shrink-0" />
                          )}
                          <span className="text-xs text-violet-400 font-medium truncate">
                            {result.metadata['channel_name']}
                          </span>
                        </div>
                      )}
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
                      {showDescription && (
                        <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                          {hasHighlight(result.descriptionHighlighted)
                            ? renderHighlightedText(stripMarkdown(result.descriptionHighlighted))
                            : description}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {showFooter && (
            <div className="border-t border-border/50 px-3 py-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground/70">
              {!showHeader && (
                <span className="mr-auto text-muted-foreground/60">
                  {resultCountLabel(results.length, totalCount)}
                </span>
              )}
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
