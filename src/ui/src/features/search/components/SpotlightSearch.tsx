import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useSearch } from '@/features/search/hooks/useSearch';
import { useSpotlightOpenListener } from '@/features/search/hooks/useSpotlightTrigger';
import { SearchResultsList } from '@/features/search/components/SearchResultsList';
import { FilterChip } from '@/features/search/components/FilterChip';
import { FilterHints } from '@/features/search/components/FilterHints';
import { useShortcutHandler, useFormattedKeybinding } from '@/features/settings';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { openViewerWithFetch } from '@/features/files';
import { openRoomViewer } from '@/features/rooms/store/roomsThunks';
import { createChannel } from '@/features/chat/store/chatThunks';
import { ChannelType } from '@uniffy/proto/chat/v1/chat_pb';
import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';
import { cn } from '@/shared/utils/cn';
import {
    getTypeFilterLabel,
    removeTypeFilterFromQuery,
    removeTagFilterFromQuery,
    removeMyFilterFromQuery,
    removeProjectFilterFromQuery,
    removePhraseFromQuery,
} from '@/features/search/utils/queryParser';
import { getRouteTypePriority } from '@/features/search/utils/typePriority';
import {
    getRecentItems,
    recordRecentItem,
    recentItemToSearchResult,
} from '@/features/search/utils/recentItems';
import { selectDirectMessages } from '@/features/chat/store/chatChannelsSlice';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { SUBJECT_TYPE } from '@/components/subject/types';

export function SpotlightSearch() {
    const navigate = useNavigate();
    const dispatch = useAppDispatch();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [copiedUrn, setCopiedUrn] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const routePriority = getRouteTypePriority(location.pathname);
    const searchOptions = useMemo(
        () => (routePriority ? { typePriority: routePriority } : undefined),
        [routePriority],
    );

    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const userId = useAppSelector((state) => state.auth.user?.id);
    const directMessages = useAppSelector(selectDirectMessages);

    const recentResults = useMemo(() => {
        if (!isOpen || !organizationId || !userId) return [];
        return getRecentItems(organizationId, userId).map(recentItemToSearchResult);
    }, [isOpen, organizationId, userId]);

    const peopleDms = useMemo(
        () => directMessages.filter((c) => c.channelType === 'DIRECT').slice(0, 4),
        [directMessages],
    );

    const { query, setQuery, results, totalCount, isLoading, clearResults, parsedQuery, hasFilters } = useSearch(searchOptions);
    const shortcutDisplay = useFormattedKeybinding('nav.search');

    const handleRemoveTypeFilter = useCallback((type: number) => {
        const newQuery = removeTypeFilterFromQuery(query, type);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemoveTagFilter = useCallback((tag: string) => {
        const newQuery = removeTagFilterFromQuery(query, tag);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemoveProjectFilter = useCallback((project: string) => {
        const newQuery = removeProjectFilterFromQuery(query, project);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemoveMyFilter = useCallback(() => {
        const newQuery = removeMyFilterFromQuery(query);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemovePhraseFilter = useCallback((phrase: string) => {
        const newQuery = removePhraseFromQuery(query, phrase);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleFilterHintClick = useCallback((filter: string) => {
        setQuery(filter + ' ');
        inputRef.current?.focus();
    }, [setQuery]);

    // Bound inline rather than via effect to avoid cascading renders when results change.
    const boundedSelectedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);

    const copySelectedUrn = useCallback(async () => {
        const selected = results[boundedSelectedIndex];
        if (!selected?.urn) return;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(selected.urn);
            } else {
                // navigator.clipboard is gated to secure contexts; fall back to execCommand.
                const textArea = document.createElement('textarea');
                textArea.value = selected.urn;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            setCopiedUrn(true);
            setTimeout(() => setCopiedUrn(false), 1500);
        } catch {
            // clipboard unavailable
        }
    }, [results, boundedSelectedIndex]);

    const handleOpen = useCallback(() => {
        setIsOpen(true);
    }, []);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        clearResults();
    }, [clearResults]);

    const handleResultSelect = useCallback(async (result: SearchResultItem) => {
        if (organizationId && userId) {
            recordRecentItem(organizationId, userId, {
                urn: result.urn,
                title: result.title,
                type: result.type,
                url: result.url,
            });
        }

        // Files open in the viewer modal so the user stays on the current page.
        if (result.type === SearchResultType.FILE) {
            const fileId = result.urn.split(':').pop();
            if (fileId) {
                dispatch(openViewerWithFetch({ fileId }));
            }
            handleClose();
            return;
        }

        // Rooms open in the viewer modal for the same reason.
        if (result.type === SearchResultType.ROOM) {
            const roomId = result.urn.split(':').pop();
            if (roomId) {
                dispatch(openRoomViewer({ roomId }));
                handleClose();
                return;
            }
        }

        // Users open the 1:1 DM (create_dm is idempotent for pairs) instead of a profile page.
        if (result.type === SearchResultType.USER) {
            const userId = result.urn.split(':').pop();
            if (userId) {
                try {
                    const channel = await dispatch(
                        createChannel({
                            name: '',
                            channelType: ChannelType.DIRECT,
                            memberIds: [userId],
                        }),
                    ).unwrap();
                    navigate(`/chat/${channel.id}`);
                    handleClose();
                    return;
                } catch {
                    // Fall through to default navigation.
                }
            }
        }

        navigate(result.url);
        handleClose();
    }, [navigate, dispatch, handleClose, organizationId, userId]);

    useShortcutHandler('nav.search', handleOpen);
    useSpotlightOpenListener(handleOpen);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                handleClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, handleClose]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (results.length > 0) {
                e.preventDefault();
                copySelectedUrn();
            }
        }
    };

    const handleClear = () => {
        clearResults();
        inputRef.current?.focus();
    };

    if (!isOpen) {
        return null;
    }

    return (
        <>
            <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[999] animate-in fade-in-0 duration-150" />

            <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]">
                <div
                    ref={containerRef}
                    className="w-full max-w-2xl mx-4 animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200"
                >
                    <div className="rounded-2xl border-2 border-primary/50 bg-card shadow-2xl ring-4 ring-primary/10 overflow-hidden">
                        <div className="relative flex items-center border-b border-border/50">
                            <MagnifyingGlass size={20} weight="bold" className="absolute left-4 text-muted-foreground" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={handleInputChange}
                                onKeyDown={handleInputKeyDown}
                                placeholder="Search notes, files, and more..."
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
                                {query && (
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
                                    <FilterChip
                                        label="My content"
                                        onRemove={handleRemoveMyFilter}
                                    />
                                )}
                                {parsedQuery.filters.exactPhrases.map((phrase) => (
                                    <FilterChip
                                        key={`phrase-${phrase}`}
                                        label={`"${phrase}"`}
                                        variant="exact"
                                        onRemove={() => handleRemovePhraseFilter(phrase)}
                                    />
                                ))}
                            </div>
                        )}

                        {query.trim() || isLoading || hasFilters ? (
                            <SearchResultsList
                                results={results}
                                isLoading={isLoading}
                                query={query}
                                onSelect={handleResultSelect}
                                onClose={handleClose}
                                className="border-0 shadow-none ring-0 rounded-none max-h-[60vh]"
                                showHeader={false}
                                showFooter={true}
                                selectedIndex={boundedSelectedIndex}
                                onSelectedIndexChange={setSelectedIndex}
                                copiedUrn={copiedUrn}
                                totalCount={totalCount}
                            />
                        ) : recentResults.length > 0 || peopleDms.length > 0 ? (
                            <div className="pb-2">
                                {peopleDms.length > 0 && (
                                    <div className="px-4 pt-3">
                                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-2">
                                            People
                                        </p>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {peopleDms.map((channel) => {
                                                const otherId =
                                                    channel.dmMemberIds.find((id) => id !== userId)
                                                    ?? channel.dmMemberIds[0]
                                                    ?? '';
                                                const name = getChannelDisplayName(channel);
                                                return (
                                                    <button
                                                        key={channel.id}
                                                        onClick={() => {
                                                            navigate(`/chat/${channel.id}`);
                                                            handleClose();
                                                        }}
                                                        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-muted/50 hover:bg-muted transition-colors"
                                                    >
                                                        <SubjectAvatar
                                                            subject={{ id: otherId, type: SUBJECT_TYPE.USER, name }}
                                                            size="sm"
                                                        />
                                                        <span className="text-sm text-foreground/80">{name}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {recentResults.length > 0 && (
                                    <>
                                        <p className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
                                            Recent
                                        </p>
                                        <SearchResultsList
                                            results={recentResults}
                                            isLoading={false}
                                            onSelect={handleResultSelect}
                                            onClose={handleClose}
                                            className="border-0 shadow-none ring-0 rounded-none max-h-[50vh]"
                                            showHeader={false}
                                            showFooter={false}
                                        />
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="py-8 px-4 text-center">
                                <p className="text-sm text-muted-foreground">
                                    Type to search across all your content
                                </p>
                                <p className="text-xs text-muted-foreground/60 mt-2 mb-4">
                                    Press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 font-mono text-[10px]">{shortcutDisplay}</kbd> anytime to open search
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
