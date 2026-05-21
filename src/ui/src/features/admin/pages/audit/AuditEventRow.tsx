/**
 * AuditEventRow
 *
 * Single audit event row rendered inside the Virtuoso list. Click to
 * toggle inline expansion showing full details JSON, full URNs, IP,
 * user-agent, and event id.
 */

import { useMemo } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { isValidUrn, urnToPath } from '@/shared/utils/urn';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import type { SerializedAuditEvent } from '@/features/admin/store/auditSlice';
import {
    actionDomainColor,
    actionLabel,
} from '@/features/admin/pages/audit/actionCatalog';

export interface AuditEventRowProps {
    event: SerializedAuditEvent;
    expanded: boolean;
    onToggleExpanded: () => void;
    gridTemplate: string;
    showIp: boolean;
}

export function AuditEventRow({
    event,
    expanded,
    onToggleExpanded,
    gridTemplate,
    showIp,
}: AuditEventRowProps) {
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

    return (
        <div
            className={cn(
                'group border-b border-border transition-colors',
                expanded ? 'bg-accent/30' : 'hover:bg-accent/50',
            )}
        >
            <button
                type="button"
                onClick={onToggleExpanded}
                style={{ gridTemplateColumns: gridTemplate }}
                className="grid w-full items-center gap-3 px-3 md:px-4 lg:px-6 py-2.5 md:py-3 text-left text-sm"
            >
                <span className="shrink-0 text-muted-foreground">
                    {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                </span>

                <span
                    className="text-xs text-muted-foreground"
                    title={event.createdAt}
                >
                    {formatRelativeTime(event.createdAt)}
                </span>

                <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                    {actor ? (
                        <>
                            <SubjectAvatar subject={actor} size="xs" />
                            <span className="min-w-0 truncate text-foreground">
                                {actor.name}
                            </span>
                        </>
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
                </span>

                <span className="min-w-0 overflow-hidden flex items-center">
                    <span
                        className={cn(
                            'inline-block min-w-0 max-w-full truncate px-2 py-0.5 rounded text-xs font-medium',
                            actionDomainColor(event.action),
                        )}
                        title={event.action}
                    >
                        {actionLabel(event.action)}
                    </span>
                </span>

                <span className="min-w-0 overflow-hidden text-xs flex items-center">
                    {target.urn ? (
                        <a
                            href={urnToPath(target.urn)}
                            onClick={(event_) => event_.stopPropagation()}
                            className="block min-w-0 max-w-full truncate text-foreground hover:underline"
                            title={target.tooltip}
                        >
                            {target.label}
                        </a>
                    ) : target.label ? (
                        <span
                            className="block min-w-0 max-w-full truncate text-foreground"
                            title={target.tooltip}
                        >
                            {target.label}
                        </span>
                    ) : (
                        <span className="text-muted-foreground italic">-</span>
                    )}
                </span>

                {showIp && (
                    <span className="min-w-0 text-xs text-muted-foreground truncate font-mono">
                        {event.ipAddress ?? <span className="italic font-sans">-</span>}
                    </span>
                )}
            </button>

            {expanded && <AuditEventDetailsPanel event={event} />}
        </div>
    );
}

interface DetailsPanelProps {
    event: SerializedAuditEvent;
}

function AuditEventDetailsPanel({ event }: DetailsPanelProps) {
    const parsed = useMemo(() => {
        try {
            return JSON.parse(event.detailsJson || '{}') as Record<string, unknown>;
        } catch {
            return null;
        }
    }, [event.detailsJson]);

    return (
        <div className="bg-background/60 border-t border-border px-4 md:px-6 py-3 grid gap-3 md:grid-cols-2 text-xs">
            <DetailField label="Event ID" value={event.id} mono />
            <DetailField label="Timestamp" value={event.createdAt} mono />
            <DetailField
                label="Resource"
                value={buildResourceUrn(event) ?? '-'}
                mono
            />
            <DetailField
                label="On behalf of"
                value={event.onBehalfOfUserId ?? '-'}
                mono
            />
            <DetailField label="IP address" value={event.ipAddress ?? '-'} mono />
            <DetailField
                label="User agent"
                value={event.userAgent ?? '-'}
            />
            <div className="md:col-span-2 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Details
                </div>
                {parsed ? (
                    <pre className="rounded-md bg-muted/60 border border-border p-3 overflow-x-auto text-[11px] leading-relaxed text-foreground">
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                ) : (
                    <p className="text-muted-foreground italic">No structured details</p>
                )}
            </div>
        </div>
    );
}

interface DetailFieldProps {
    label: string;
    value: string;
    mono?: boolean;
}

function DetailField({ label, value, mono }: DetailFieldProps) {
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

function buildResourceUrn(event: SerializedAuditEvent): string | null {
    if (!event.resourceType || !event.resourceId) return null;
    const candidate = `urn:uniffy:content:${event.resourceType}:${event.resourceId}`;
    return isValidUrn(candidate) ? candidate : null;
}

interface TargetCell {
    label: string;
    tooltip: string;
    urn: string | null;
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

function buildTarget(event: SerializedAuditEvent): TargetCell {
    const urn = buildResourceUrn(event);
    let details: Record<string, unknown> = {};
    try {
        details = JSON.parse(event.detailsJson || '{}') as Record<string, unknown>;
    } catch {
        // malformed JSON - treat as empty
    }

    if (event.action === 'domain_admin.granted' || event.action === 'domain_admin.revoked') {
        const domain = String(details.domain ?? '').trim();
        const userSnippet = event.resourceId ? event.resourceId.slice(0, 6) : '';
        const label = domain
            ? userSnippet
                ? `${domain} (user ${userSnippet})`
                : domain
            : userSnippet
                ? `user ${userSnippet}`
                : '';
        return { label, tooltip: label || event.action, urn };
    }

    if (event.action === 'chat_message.deleted_by_admin') {
        const channelId = String(details.channel_id ?? '');
        const label = channelId
            ? `channel ${channelId.slice(0, 6)}...`
            : 'chat message';
        return {
            label,
            tooltip: channelId ? `channel_id=${channelId}` : 'chat message',
            urn: null,
        };
    }

    if (event.action.startsWith('agent.tool_call.')) {
        const tool = String(details.tool_name ?? event.action.slice('agent.tool_call.'.length));
        const status = details.status ? ` (${String(details.status)})` : '';
        const label = `${tool}${status}`;
        return { label, tooltip: label, urn };
    }

    if (event.action === 'agent.image_generation') {
        const model = String(details.model_id ?? '');
        const size = String(details.size ?? '');
        const label = [model, size].filter(Boolean).join(' · ') || 'image';
        return { label, tooltip: label, urn };
    }

    for (const key of FRIENDLY_KEYS) {
        const value = details[key];
        if (typeof value === 'string' && value.length > 0) {
            return { label: value, tooltip: `${key}=${value}`, urn };
        }
    }

    if (urn) {
        const short = `${event.resourceType}:${(event.resourceId ?? '').slice(0, 8)}`;
        return { label: short, tooltip: urn, urn };
    }

    return { label: '', tooltip: '', urn: null };
}

