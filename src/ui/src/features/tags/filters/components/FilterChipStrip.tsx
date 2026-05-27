import type { ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { TagChip } from '@/features/tags/components/TagChip';
import {
    emptyCriteria,
    type SerializedTagFilterCriteria,
} from '@/features/tags/store/tagsThunks';
import {
    getContentTypeConfig,
} from '@/config/theme/contentTypes';
import { ContentType, AccessMode } from '@uniffy/proto/common/v1/common_pb';
import { UrnType } from '@/shared/utils/urnTypes';
import { isCriteriaEmpty } from '@/features/tags/hooks/useTagFilterState';
import { formatDateShort } from '@/shared/utils/dateFormatting';

interface FilterChipStripProps {
    criteria: SerializedTagFilterCriteria;
    onChange: (next: SerializedTagFilterCriteria) => void;
    onReset?: () => void;
}

const URN_TYPE_FROM_CONTENT_TYPE: Record<number, UrnType> = {
    [ContentType.NOTE]: UrnType.NOTE,
    [ContentType.FILE]: UrnType.FILE,
    [ContentType.CHAT]: UrnType.CHAT,
    [ContentType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
    [ContentType.PROJECT]: UrnType.PROJECT,
    [ContentType.TASK]: UrnType.TASK,
    [ContentType.AGENT]: UrnType.AGENT,
};

const ACCESS_MODE_LABEL: Record<number, string> = {
    [AccessMode.OWNER_ONLY]: 'Owner only',
    [AccessMode.EXPLICIT_MEMBERS]: 'Members',
    [AccessMode.OPEN_TO_ORG]: 'Open to org',
};

export function FilterChipStrip({
    criteria,
    onChange,
    onReset,
}: FilterChipStripProps): ReactNode | null {
    const tagsById = useAppSelector((s) => s.tags.byId);

    if (isCriteriaEmpty(criteria)) {
        return null;
    }

    const remove = (patch: Partial<SerializedTagFilterCriteria>) =>
        onChange({ ...criteria, ...patch });

    return (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Filters
            </span>
            {criteria.tagIds.map((id) => {
                const tag = tagsById[id];
                if (!tag) {
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() =>
                                remove({
                                    tagIds: criteria.tagIds.filter((tid) => tid !== id),
                                })
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                        >
                            tag:#{id.slice(0, 6)}
                            <X size={10} weight="bold" />
                        </button>
                    );
                }
                return (
                    <span
                        key={id}
                        className="inline-flex items-center gap-1"
                    >
                        <TagChip
                            tag={tag}
                            onRemove={() =>
                                remove({
                                    tagIds: criteria.tagIds.filter((tid) => tid !== id),
                                })
                            }
                            nonInteractive
                        />
                    </span>
                );
            })}
            {criteria.contentTypes.map((type) => {
                const config = getContentTypeConfig(
                    URN_TYPE_FROM_CONTENT_TYPE[type] ?? UrnType.UNKNOWN
                );
                return (
                    <Chip
                        key={`type-${type}`}
                        onRemove={() =>
                            remove({
                                contentTypes: criteria.contentTypes.filter(
                                    (t) => t !== type
                                ),
                            })
                        }
                    >
                        {config.labelPlural}
                    </Chip>
                );
            })}
            {criteria.ownerIds.map((id) => (
                <Chip
                    key={`owner-${id}`}
                    onRemove={() =>
                        remove({
                            ownerIds: criteria.ownerIds.filter((oid) => oid !== id),
                        })
                    }
                >
                    Owner: {id.slice(0, 6)}
                </Chip>
            ))}
            {criteria.sources.map((source) => (
                <Chip
                    key={`source-${source}`}
                    onRemove={() =>
                        remove({
                            sources: criteria.sources.filter((s) => s !== source),
                        })
                    }
                >
                    {source === 'manual' ? 'Manual' : 'Inline'}
                </Chip>
            ))}
            {criteria.createdAfter && (
                <Chip onRemove={() => remove({ createdAfter: null })}>
                    Created after {formatDateShort(criteria.createdAfter)}
                </Chip>
            )}
            {criteria.createdBefore && (
                <Chip onRemove={() => remove({ createdBefore: null })}>
                    Created before {formatDateShort(criteria.createdBefore)}
                </Chip>
            )}
            {criteria.updatedAfter && (
                <Chip onRemove={() => remove({ updatedAfter: null })}>
                    Updated after {formatDateShort(criteria.updatedAfter)}
                </Chip>
            )}
            {criteria.updatedBefore && (
                <Chip onRemove={() => remove({ updatedBefore: null })}>
                    Updated before {formatDateShort(criteria.updatedBefore)}
                </Chip>
            )}
            {criteria.accessMode !== null && (
                <Chip onRemove={() => remove({ accessMode: null })}>
                    Access: {ACCESS_MODE_LABEL[criteria.accessMode] ?? 'Unknown'}
                </Chip>
            )}
            {criteria.untaggedOnly && (
                <Chip onRemove={() => remove({ untaggedOnly: false })}>
                    Untagged only
                </Chip>
            )}
            {onReset && (
                <button
                    type="button"
                    onClick={onReset ?? (() => onChange(emptyCriteria()))}
                    className="ml-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                    Reset
                </button>
            )}
        </div>
    );
}

function Chip({
    children,
    onRemove,
    className,
}: {
    children: ReactNode;
    onRemove: () => void;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground',
                className
            )}
        >
            {children}
            <button
                type="button"
                onClick={onRemove}
                className="rounded-full p-0.5 hover:bg-muted"
                aria-label="Remove filter"
            >
                <X size={10} weight="bold" />
            </button>
        </span>
    );
}
