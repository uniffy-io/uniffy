import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Panel, Group, Separator } from 'react-resizable-panels';
import {
    CaretDoubleLeft,
    Funnel,
    GridFour,
    ListBullets,
    MagnifyingGlass,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useShortcutHandler } from '@/features/settings';
import { AppHeader } from '@/components/layout/AppHeader';
import { Drawer } from '@/components/ui/drawer';
import {
    CollapsibleSidebarRail,
    type SidebarSection,
} from '@/components/layout/CollapsibleSidebarRail';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { TagSort } from '@uniffy/proto/tags/v1/tags_pb';
import {
    listContentByTagThunk,
    listTagsThunk,
    type SerializedSavedTagFilter,
    type SerializedTag,
} from '@/features/tags/store/tagsThunks';
import { TagCloud } from '@/features/tags/components/TagCloud';
import { TagList } from '@/features/tags/components/TagList';
import { TagContentList } from '@/features/tags/components/TagContentList';
import { TagEditDialog } from '@/features/tags/components/TagEditDialog';
import { TagNotFound } from '@/features/tags/components/TagNotFound';
import { FilterRail } from '@/features/tags/filters/components/FilterRail';
import { FilterChipStrip } from '@/features/tags/filters/components/FilterChipStrip';
import { SavedFiltersDropdown } from '@/features/tags/filters/components/SavedFiltersDropdown';
import {
    TagFilterBuilder,
    type SaveTagFilterPayload,
} from '@/features/tags/filters/components/TagFilterBuilder';
import {
    criteriaEquals,
    useTagFilterState,
} from '@/features/tags/hooks/useTagFilterState';
import { useSavedTagFilters } from '@/features/tags/hooks/useSavedTagFilters';
import { useTagsRealtime } from '@/features/tags/hooks/useTagsRealtime';
import { useTagById, useTagsByIds } from '@/features/tags/store/selectors';

type IndexView = 'list' | 'cloud';

const TAGS_SECTIONS: SidebarSection[] = [
    { id: 'filters', icon: Funnel, label: 'Filters' },
];

export function TagsExplorerPage() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { slug } = useParams<{ slug?: string }>();
    const { isMobile, isMobileOrTablet } = useBreakpoint();
    const isZenMode = useAppSelector((s) => s.zenMode.isActive);

    const [indexView, setIndexView] = useState<IndexView>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const handle = window.setTimeout(() => setDebouncedSearch(searchQuery), 250);
        return () => window.clearTimeout(handle);
    }, [searchQuery]);
    const [editingTag, setEditingTag] = useState<SerializedTag | null>(null);
    const [filterSidebarOpen, setFilterSidebarOpen] = useState(true);
    const [defaultLayout] = useState(() => loadPanelLayout('tags'));
    const [builderState, setBuilderState] = useState<
        | { mode: 'create' }
        | { mode: 'edit'; filter: SerializedSavedTagFilter }
        | null
    >(null);
    const [activeSavedFilterId, setActiveSavedFilterId] = useState<string | null>(
        null
    );

    const { criteria, setCriteria, reset } = useTagFilterState();
    const savedFilters = useSavedTagFilters();
    useTagsRealtime();

    const bySlug = useAppSelector((s) => s.tags.bySlug);
    const listIds = useAppSelector((s) => s.tags.listIds);
    const listStatus = useAppSelector((s) => s.tags.listStatus);
    const listNextPageToken = useAppSelector((s) => s.tags.listNextPageToken);
    const contentByTag = useAppSelector((s) => s.tags.contentByTag);

    const allListedTags = useTagsByIds(listIds);
    const tags = useMemo(() => {
        if (criteria.tagIds.length === 0) return allListedTags as SerializedTag[];
        const selected = new Set(criteria.tagIds);
        return (allListedTags as SerializedTag[]).filter((t) => selected.has(t.id));
    }, [allListedTags, criteria.tagIds]);

    const selectedTagId = slug ? (bySlug[slug] ?? slug) : undefined;
    const selectedTag = useTagById(selectedTagId) ?? null;
    const selectedTagSlug = selectedTag?.slug;

    useDocumentTitle(selectedTag ? `#${selectedTag.slug}` : 'Tags');

    const contentTypesKey = useMemo(
        () => criteria.contentTypes.join(','),
        [criteria.contentTypes]
    );
    const criteriaKey = useMemo(() => JSON.stringify(criteria), [criteria]);

    useEffect(() => {
        dispatch(
            listTagsThunk({
                query: debouncedSearch,
                sort: TagSort.RECENT_DESC,
                contentTypes: criteria.contentTypes,
            })
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- contentTypesKey is the stable signature of criteria.contentTypes
    }, [dispatch, debouncedSearch, contentTypesKey]);

    useEffect(() => {
        if (!selectedTagSlug) return;
        dispatch(
            listContentByTagThunk({
                tag: selectedTagSlug,
                criteria,
            })
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- criteriaKey is the stable signature of criteria
    }, [dispatch, selectedTagSlug, criteriaKey]);

    const handleLayoutChange = useCallback((layout: Record<string, number>) => {
        savePanelLayout('tags', layout);
    }, []);

    const handleSelectTag = useCallback(
        (tag: SerializedTag) => {
            navigate(`/tags/${tag.slug}${window.location.search}`);
        },
        [navigate]
    );

    const handleLoadMoreTags = useCallback(() => {
        if (!listNextPageToken) return;
        dispatch(
            listTagsThunk({
                query: debouncedSearch,
                sort: TagSort.RECENT_DESC,
                contentTypes: criteria.contentTypes,
                pageToken: listNextPageToken,
            })
        );
    }, [dispatch, listNextPageToken, debouncedSearch, criteria.contentTypes]);

    const contentBucket = selectedTag ? contentByTag[selectedTag.slug] : undefined;

    const handleLoadMoreContent = useCallback(() => {
        if (!selectedTag || !contentBucket?.nextPageToken) return;
        dispatch(
            listContentByTagThunk({
                tag: selectedTag.slug,
                criteria,
                pageToken: contentBucket.nextPageToken,
            })
        );
    }, [dispatch, selectedTag, contentBucket, criteria]);

    const handleSavedFilterLoad = useCallback(
        (filter: SerializedSavedTagFilter) => {
            setCriteria(filter.criteria);
            setActiveSavedFilterId(filter.id);
        },
        [setCriteria]
    );

    const isDirty = useMemo(() => {
        if (!activeSavedFilterId) return false;
        const active = savedFilters.byId[activeSavedFilterId];
        if (!active) return true;
        return !criteriaEquals(active.criteria, criteria);
    }, [activeSavedFilterId, criteria, savedFilters.byId]);

    const handleSaveAs = useCallback(() => {
        setBuilderState({ mode: 'create' });
    }, []);

    const handleBuilderSubmit = useCallback(
        async (payload: SaveTagFilterPayload) => {
            try {
                if (builderState?.mode === 'edit') {
                    await savedFilters.update({
                        filterId: builderState.filter.id,
                        name: payload.name,
                        description: payload.description,
                        icon: payload.icon,
                        criteria: payload.criteria,
                        sortBy: payload.sortBy,
                        sortOrder: payload.sortOrder,
                    });
                    setActiveSavedFilterId(builderState.filter.id);
                } else {
                    const created = await savedFilters.create(payload);
                    setActiveSavedFilterId(created.id);
                }
            } finally {
                setBuilderState(null);
            }
        },
        [builderState, savedFilters]
    );

    const items = useMemo(
        () =>
            contentBucket?.urns
                .map((urn) => contentBucket.items[urn])
                .filter(Boolean) ?? [],
        [contentBucket]
    );

    const showSidebar = filterSidebarOpen && !isZenMode;
    const sidebarAsDrawer = isMobile;
    const showCollapsedRail = !isZenMode && !showSidebar && !sidebarAsDrawer;

    const handleToggleSidebar = useCallback(() => {
        setFilterSidebarOpen((open) => !open);
    }, []);

    useShortcutHandler('app.toggleSidebar', handleToggleSidebar);

    const railPanel = (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
                <Funnel
                    size={16}
                    weight="duotone"
                    className="text-muted-foreground shrink-0 ml-1"
                />
                <span className="text-sm font-semibold text-foreground ml-1.5">
                    Filters
                </span>
                <div className="flex-1" />
                {!isMobile && (
                    <button
                        type="button"
                        onClick={handleToggleSidebar}
                        className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
                        title="Toggle sidebar"
                    >
                        <CaretDoubleLeft
                            size={16}
                            weight="bold"
                            className="text-primary"
                        />
                    </button>
                )}
            </div>
            <FilterRail criteria={criteria} onChange={setCriteria} />
        </div>
    );

    const tagIndex = (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <div className="border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <MagnifyingGlass
                            size={14}
                            weight="duotone"
                            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search tags..."
                            className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-sm focus:border-primary focus:outline-none"
                        />
                    </div>
                    <div className="flex items-center rounded-md border border-border">
                        <button
                            type="button"
                            onClick={() => setIndexView('list')}
                            className={cn(
                                'p-1',
                                indexView === 'list'
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                            aria-label="List view"
                        >
                            <ListBullets size={14} weight="duotone" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIndexView('cloud')}
                            className={cn(
                                'p-1',
                                indexView === 'cloud'
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                            aria-label="Cloud view"
                        >
                            <GridFour size={14} weight="duotone" />
                        </button>
                    </div>
                </div>
                <FilterChipStrip
                    criteria={criteria}
                    onChange={setCriteria}
                    onReset={reset}
                />
            </div>
            <div className="flex-1 overflow-y-auto">
                {indexView === 'cloud' ? (
                    <TagCloud
                        tags={tags}
                        selectedTagId={selectedTag?.id ?? null}
                        onSelect={handleSelectTag}
                    />
                ) : (
                    <TagList
                        tags={tags}
                        selectedTagId={selectedTag?.id ?? null}
                        onSelect={handleSelectTag}
                        onEdit={setEditingTag}
                        nextPageToken={listNextPageToken}
                        onLoadMore={handleLoadMoreTags}
                        isLoadingMore={listStatus === 'loading'}
                    />
                )}
            </div>
        </div>
    );

    const contentPanel =
        slug && !selectedTag && listStatus === 'succeeded' ? (
            <TagNotFound slug={slug} />
        ) : (
            <TagContentList
                selectedTag={selectedTag}
                items={items}
                nextPageToken={contentBucket?.nextPageToken}
                onLoadMore={handleLoadMoreContent}
                isLoading={contentBucket?.status === 'loading'}
            />
        );

    const pageHeader = (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
            <h1 className="text-sm font-semibold text-foreground">Tags</h1>
            <SavedFiltersDropdown
                filters={savedFilters.filters}
                activeFilterId={activeSavedFilterId}
                isDirty={
                    isDirty ||
                    (!activeSavedFilterId && savedFilters.filters.length === 0)
                }
                onLoad={handleSavedFilterLoad}
                onSaveAs={handleSaveAs}
                onReset={() => {
                    setActiveSavedFilterId(null);
                    reset();
                }}
            />
        </div>
    );

    return (
        <>
            <AppHeader />
            <div
                className={cn(
                    'relative bg-background overflow-hidden transition-[height] duration-300 ease-in-out',
                    isZenMode ? 'h-dvh delay-150' : 'h-[calc(100dvh-3rem)] delay-0'
                )}
            >
                {showCollapsedRail && (
                    <div className="absolute inset-y-0 left-0 z-30 w-12">
                        <CollapsibleSidebarRail
                            onExpand={handleToggleSidebar}
                            sections={TAGS_SECTIONS}
                        >
                            {railPanel}
                        </CollapsibleSidebarRail>
                    </div>
                )}

                <Group
                    orientation="horizontal"
                    className="h-full w-full flex"
                    defaultLayout={defaultLayout}
                    onLayoutChange={handleLayoutChange}
                >
                    {showSidebar && !sidebarAsDrawer && (
                        <>
                            <Panel
                                id="tags-sidebar"
                                defaultSize={isMobileOrTablet ? 220 : 260}
                                minSize={180}
                                maxSize={isMobileOrTablet ? 320 : 400}
                                className="bg-background overflow-hidden"
                            >
                                {railPanel}
                            </Panel>
                            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                        </>
                    )}

                    <Panel
                        id="tags-content"
                        minSize={isMobileOrTablet ? 240 : 400}
                        className={cn('overflow-hidden', showCollapsedRail && 'ml-12')}
                    >
                        <div className="flex h-full flex-col overflow-hidden bg-background">
                            {pageHeader}
                            {isMobile ? (
                                <div className="flex flex-1 flex-col overflow-hidden">
                                    {tagIndex}
                                </div>
                            ) : (
                                <Group
                                    orientation="horizontal"
                                    className="flex-1 w-full flex"
                                    defaultLayout={loadPanelLayout('tags-inner')}
                                    onLayoutChange={(l: Record<string, number>) =>
                                        savePanelLayout('tags-inner', l)
                                    }
                                >
                                    <Panel
                                        id="tags-index"
                                        defaultSize={isMobileOrTablet ? 280 : 380}
                                        minSize={220}
                                    >
                                        <div className="h-full overflow-hidden border-r border-border">
                                            {tagIndex}
                                        </div>
                                    </Panel>
                                    <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                                    <Panel
                                        id="tags-content-pane"
                                        minSize={isMobileOrTablet ? 280 : 360}
                                    >
                                        <div className="h-full overflow-hidden bg-card">
                                            {contentPanel}
                                        </div>
                                    </Panel>
                                </Group>
                            )}
                        </div>
                    </Panel>
                </Group>

                {sidebarAsDrawer && (
                    <Drawer
                        open={showSidebar}
                        onClose={handleToggleSidebar}
                        side="left"
                        className="w-72"
                        ariaLabel="Tag explorer filters"
                    >
                        {railPanel}
                    </Drawer>
                )}
            </div>

            {editingTag && (
                <TagEditDialog
                    tag={editingTag}
                    onClose={() => setEditingTag(null)}
                />
            )}

            {builderState && (
                <TagFilterBuilder
                    initial={
                        builderState.mode === 'edit' ? builderState.filter : null
                    }
                    initialCriteria={criteria}
                    onClose={() => setBuilderState(null)}
                    onSubmit={handleBuilderSubmit}
                />
            )}
        </>
    );
}
