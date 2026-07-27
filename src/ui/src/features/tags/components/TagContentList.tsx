import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { urnToPath, parseUrn } from '@/shared/utils/urn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { UrnType } from '@/shared/utils/urnTypes';
import { TagChip } from '@/features/tags/components/TagChip';
import { useMentionState } from '@/components/mention/useMentionState';
import type {
    SerializedTag,
    SerializedTaggedContentItem,
} from '@/features/tags/store/tagsThunks';

interface TagContentListProps {
    selectedTag: SerializedTag | null;
    items: SerializedTaggedContentItem[];
    nextPageToken?: string;
    onLoadMore?: () => void;
    isLoading?: boolean;
    isLoadingMore?: boolean;
}

const URN_TYPE_FROM_CONTENT_TYPE: Record<number, UrnType> = {
    [ContentType.NOTE]: UrnType.NOTE,
    [ContentType.FILE]: UrnType.FILE,
    [ContentType.CHAT]: UrnType.CHAT,
    [ContentType.USER]: UrnType.USER,
    [ContentType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
    [ContentType.PROJECT]: UrnType.PROJECT,
    [ContentType.TASK]: UrnType.TASK,
    [ContentType.AGENT]: UrnType.AGENT,
      [ContentType.ROOM]: UrnType.ROOM,
};

interface GroupedItems {
    type: ContentType;
    items: SerializedTaggedContentItem[];
}

function groupItemsByType(items: SerializedTaggedContentItem[]): GroupedItems[] {
    const buckets = new Map<ContentType, SerializedTaggedContentItem[]>();
    for (const item of items) {
        const arr = buckets.get(item.contentType) ?? [];
        arr.push(item);
        buckets.set(item.contentType, arr);
    }
    return Array.from(buckets.entries())
        .map(([type, typeItems]) => ({ type, items: typeItems }))
        .sort((a, b) => b.items.length - a.items.length);
}

interface TagContentRowProps {
    item: SerializedTaggedContentItem;
}

function TagContentRow({ item }: TagContentRowProps) {
    const parsed = parseUrn(item.urn);
    const config = getContentTypeConfig(parsed.type);
    const Icon = config.icon;
    const liveState = useMentionState(item.urn);
    const resolvedTitle = liveState?.title || item.title || '';
    const isResolved = resolvedTitle.length > 0;
    const snippet = item.snippet || liveState?.description || '';

    if (!isResolved) {
        return (
            <div
                aria-busy="true"
                className={cn(
                    'flex items-center gap-3 rounded-md px-2 py-2',
                    'border bg-gradient-to-r',
                    config.theme.gradient,
                    config.theme.border,
                )}
            >
                <span
                    className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-md animate-pulse',
                        config.theme.iconBoxAccent,
                    )}
                >
                    <Icon size={14} weight="duotone" />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5 animate-pulse">
                    <div className="h-3 w-2/5 rounded bg-muted" />
                    <div className="h-2.5 w-3/5 rounded bg-muted/60" />
                </div>
            </div>
        );
    }

    return (
        <Link
            to={urnToPath(item.urn)}
            className={cn(
                'flex items-center gap-3 rounded-md px-2 py-2',
                'border transition-all duration-150',
                'bg-gradient-to-r hover:shadow-sm',
                config.theme.gradient,
                config.theme.border,
                config.theme.glow,
            )}
        >
            <span
                className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-md',
                    config.theme.iconBoxAccent,
                )}
            >
                <Icon size={14} weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                    {resolvedTitle}
                </div>
                {snippet && (
                    <div className="truncate text-xs text-muted-foreground">
                        {snippet}
                    </div>
                )}
            </div>
            <span
                className={cn(
                    'shrink-0 rounded-md px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider',
                    config.theme.badgeBg,
                    config.theme.accentText,
                )}
            >
                {config.label}
            </span>
            {item.assignedAtMs && (
                <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    {formatRelativeTime(
                        new Date(item.assignedAtMs).toISOString(),
                    )}
                </span>
            )}
        </Link>
    );
}

export function TagContentList({
    selectedTag,
    items,
    nextPageToken,
    onLoadMore,
    isLoading,
    isLoadingMore,
}: TagContentListProps) {
    const grouped = useMemo(() => groupItemsByType(items), [items]);

    if (!selectedTag) {
        return (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <p className="text-sm text-muted-foreground">
                    Pick a tag from the index to see what content carries it.
                </p>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <header className="border-b border-border bg-card/40 px-4 py-3">
                <div className="flex items-center gap-3">
                    <TagChip tag={selectedTag} nonInteractive />
                    <span className="text-sm font-semibold text-foreground">
                        {selectedTag.name}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                        {selectedTag.usageCount} item
                        {selectedTag.usageCount === 1 ? '' : 's'}
                    </span>
                </div>
                {selectedTag.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                        {selectedTag.description}
                    </p>
                )}
                {grouped.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {grouped
                            .map(
                                (g) =>
                                    `${g.items.length} ${
                                        getContentTypeConfig(
                                            URN_TYPE_FROM_CONTENT_TYPE[g.type] ?? UrnType.UNKNOWN
                                        ).labelPlural
                                    }`
                            )
                            .join(' · ')}
                    </p>
                )}
            </header>
            <div className="flex-1 overflow-y-auto">
                {isLoading && items.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        Loading...
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex h-32 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                        No content matches the current filter for{' '}
                        <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                            #{selectedTag.slug}
                        </code>
                        .
                    </div>
                ) : (
                    <div className="divide-y divide-border/40">
                        {grouped.map(({ type, items: typeItems }) => {
                            const urnTypeKey = URN_TYPE_FROM_CONTENT_TYPE[type] ?? UrnType.UNKNOWN;
                            const config = getContentTypeConfig(urnTypeKey);
                            const Icon = config.icon;
                            return (
                                <section key={type} className="px-3 py-3">
                                    <div
                                        className={cn(
                                            'mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider',
                                            config.theme.accentText,
                                        )}
                                    >
                                        <Icon size={12} weight="duotone" />
                                        {config.labelPlural}
                                        <span className="text-muted-foreground">
                                            · {typeItems.length}
                                        </span>
                                    </div>
                                    <ul className="space-y-1">
                                        {typeItems.map((item) => (
                                            <li key={item.urn}>
                                                <TagContentRow item={item} />
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            );
                        })}
                        {nextPageToken && onLoadMore && (
                            <div className="px-3 py-3 text-center">
                                <button
                                    type="button"
                                    onClick={onLoadMore}
                                    disabled={isLoadingMore}
                                    className="text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                                >
                                    {isLoadingMore ? 'Loading...' : 'Load more'}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
