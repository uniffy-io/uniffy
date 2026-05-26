import { useMemo, useState } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import {
    Table,
    TableBody,
    TableCell,
    TableEmpty,
    TableHead,
    TableHeader,
    TableLoading,
    TableRow,
} from '@/components/ui/table';
import {
    actionDomainColor,
    actionLabel,
} from '@/features/admin/pages/audit/actionCatalog';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import type { AuditEvent } from '@/components/audit/types';

export interface AuditEventTableProps {
    events: AuditEvent[];
    loading: boolean;
    /** Show the Organization column. */
    showOrganization?: boolean;
    /** Empty-state subtitle when no filters are active. */
    emptyDescription?: string;
    /** Empty-state subtitle when filters narrow the result to zero. */
    filteredEmptyDescription?: string;
    /** Whether at least one filter is active (drives empty subtitle). */
    hasActiveFilters?: boolean;
}

export function AuditEventTable({
    events,
    loading,
    showOrganization,
    emptyDescription = 'No audit events yet.',
    filteredEmptyDescription = 'Try clearing filters.',
    hasActiveFilters,
}: AuditEventTableProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const colSpan = showOrganization ? 5 : 4;

    return (
        <Table>
            <TableHeader>
                <TableRow hoverable={false}>
                    <TableHead>Action</TableHead>
                    {showOrganization && (
                        <TableHead className="hidden md:table-cell">Organization</TableHead>
                    )}
                    <TableHead className="hidden md:table-cell">Actor</TableHead>
                    <TableHead className="hidden lg:table-cell">Target</TableHead>
                    <TableHead className="hidden lg:table-cell">When</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {loading ? (
                    <TableLoading colSpan={colSpan} message="Loading audit events..." />
                ) : events.length === 0 ? (
                    <TableEmpty
                        colSpan={colSpan}
                        icon={<ClipboardText size={48} weight="duotone" />}
                        title="No audit events match"
                        description={hasActiveFilters ? filteredEmptyDescription : emptyDescription}
                    />
                ) : (
                    events.map((row) => (
                        <AuditRow
                            key={row.id}
                            event={row}
                            expanded={expandedId === row.id}
                            onToggle={() =>
                                setExpandedId((current) => (current === row.id ? null : row.id))
                            }
                            showOrganization={!!showOrganization}
                        />
                    ))
                )}
            </TableBody>
        </Table>
    );
}

interface AuditRowProps {
    event: AuditEvent;
    expanded: boolean;
    onToggle: () => void;
    showOrganization: boolean;
}

function AuditRow({ event, expanded, onToggle, showOrganization }: AuditRowProps) {
    const { subjects } = useSubjectResolver(event.actorUserId ? [event.actorUserId] : []);
    const actor = subjects[0];
    const isAgent = useMemo(() => {
        try {
            const details = JSON.parse(event.detailsJson || '{}');
            return details?.actor_kind === 'agent';
        } catch {
            return false;
        }
    }, [event.detailsJson]);
    const target = useMemo(() => buildTarget(event), [event]);
    const detailsObj = useMemo(() => {
        try {
            return JSON.parse(event.detailsJson || '{}') as Record<string, unknown>;
        } catch {
            return null;
        }
    }, [event.detailsJson]);

    return (
        <>
            <TableRow onClick={onToggle} className="cursor-pointer">
                <TableCell>
                    <span
                        className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            actionDomainColor(event.action),
                        )}
                    >
                        {actionLabel(event.action)}
                    </span>
                </TableCell>
                {showOrganization && (
                    <TableCell className="hidden md:table-cell text-muted-foreground truncate">
                        {event.organizationName ? (
                            <div className="min-w-0">
                                <div className="text-sm text-foreground truncate">
                                    {event.organizationName}
                                </div>
                            </div>
                        ) : (
                            <span className="text-xs italic">(deployment)</span>
                        )}
                    </TableCell>
                )}
                <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2 min-w-0">
                        {actor ? (
                            <>
                                <SubjectAvatar subject={actor} size="xs" />
                                <span className="truncate text-foreground">{actor.name}</span>
                            </>
                        ) : event.actorEmail ? (
                            <span className="truncate text-muted-foreground">
                                {event.actorEmail}
                            </span>
                        ) : (
                            <span className="text-muted-foreground italic">System</span>
                        )}
                        {event.actorOrgRole && (
                            <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground uppercase tracking-wider">
                                {event.actorOrgRole.toLowerCase()}
                            </span>
                        )}
                        {isAgent && (
                            <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-400 uppercase tracking-wider">
                                agent
                            </span>
                        )}
                    </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                    {target.label ? (
                        <span className="truncate" title={target.tooltip}>
                            {target.label}
                        </span>
                    ) : (
                        <span className="italic">-</span>
                    )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                    <div>{formatRelativeTime(event.createdAt)}</div>
                    <div className="text-[10px]">{formatProtoDateTime(toProtoTimestamp(event.createdAt))}</div>
                </TableCell>
            </TableRow>
            {expanded && (
                <TableRow hoverable={false}>
                    <TableCell colSpan={showOrganization ? 5 : 4} className="bg-background/60">
                        <div className="grid gap-3 md:grid-cols-2 text-xs py-1">
                            <DetailField label="Event ID" value={event.id} mono />
                            <DetailField label="Timestamp" value={event.createdAt} mono />
                            <DetailField
                                label="Resource"
                                value={
                                    event.resourceType && event.resourceId
                                        ? `${event.resourceType}:${event.resourceId}`
                                        : '-'
                                }
                                mono
                            />
                            <DetailField
                                label="On behalf of"
                                value={event.onBehalfOfUserId ?? '-'}
                                mono
                            />
                            <DetailField label="IP address" value={event.ipAddress ?? '-'} mono />
                            <DetailField label="User agent" value={event.userAgent ?? '-'} />
                            <div className="md:col-span-2 space-y-1">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                    Details
                                </div>
                                {detailsObj && Object.keys(detailsObj).length > 0 ? (
                                    <pre className="rounded-md bg-muted/60 border border-border p-3 overflow-x-auto text-[11px] leading-relaxed text-foreground">
                                        {JSON.stringify(detailsObj, null, 2)}
                                    </pre>
                                ) : (
                                    <p className="text-muted-foreground italic">
                                        No structured details
                                    </p>
                                )}
                            </div>
                        </div>
                    </TableCell>
                </TableRow>
            )}
        </>
    );
}

function DetailField({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="space-y-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div
                className={cn(
                    'text-foreground break-all',
                    mono && 'font-mono text-[11px]',
                )}
            >
                {value}
            </div>
        </div>
    );
}

interface TargetCell {
    label: string;
    tooltip: string;
}

const FRIENDLY_KEYS = [
    'filename',
    'title',
    'name',
    'channel_name',
    'group_name',
    'organization_name',
    'tool_name',
    'model_id',
    'email',
    'email_attempted',
    'hashed_email',
] as const;

function buildTarget(event: AuditEvent): TargetCell {
    let details: Record<string, unknown> = {};
    try {
        details = JSON.parse(event.detailsJson || '{}') as Record<string, unknown>;
    } catch {
        // malformed JSON
    }

    for (const key of FRIENDLY_KEYS) {
        const value = details[key];
        if (typeof value === 'string' && value.length > 0) {
            return { label: value, tooltip: `${key}=${value}` };
        }
    }

    if (event.resourceType && event.resourceId) {
        const short = `${event.resourceType}:${event.resourceId.slice(0, 8)}`;
        return {
            label: short,
            tooltip: `urn:uniffy:content:${event.resourceType}:${event.resourceId}`,
        };
    }

    return { label: '', tooltip: '' };
}

function toProtoTimestamp(iso: string): { seconds: number; nanos: number } {
    const ms = new Date(iso).getTime();
    return { seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1_000_000 };
}
