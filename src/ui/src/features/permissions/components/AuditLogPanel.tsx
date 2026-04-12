import { useMemo } from 'react';
import { ContentMemberAction, AccessMode } from '@uniffy/proto/common/v1/common_pb';
import { Button } from '@/components/ui/button';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import { formatRelativeTime, formatProtoDateTime } from '@/shared/utils/dateFormatting';
import { accessModeLabel, roleLabel } from '@/shared/utils/contentRoles';
import { useContentAuditLog } from '@/features/permissions/hooks/useContentAuditLog';
import type { SerializedMemberEvent } from '@/features/permissions/store/permissionsSlice';

interface AuditLogPanelProps {
    contentType: number;
    contentId: string;
}

function describeAction(
    event: SerializedMemberEvent,
    actorName: string,
    subjectName: string,
): string {
    switch (event.action) {
        case ContentMemberAction.MEMBER_ADDED:
            return `${actorName} added ${subjectName} as ${roleLabel(event.newRole)}`;
        case ContentMemberAction.MEMBER_ROLE_CHANGED:
            return `${actorName} changed ${subjectName}'s role from ${roleLabel(event.previousRole)} to ${roleLabel(event.newRole)}`;
        case ContentMemberAction.MEMBER_REMOVED:
            return `${actorName} removed ${subjectName}`;
        case ContentMemberAction.ACCESS_MODE_CHANGED:
            return `${actorName} changed access from ${accessModeLabel((event.previousAccessMode ?? AccessMode.OWNER_ONLY) as AccessMode)} to ${accessModeLabel((event.newAccessMode ?? AccessMode.OWNER_ONLY) as AccessMode)}`;
        case ContentMemberAction.BASELINE_ROLE_CHANGED:
            return `${actorName} changed the baseline role from ${roleLabel(event.previousBaselineRole)} to ${roleLabel(event.newBaselineRole)}`;
        case ContentMemberAction.OWNERSHIP_TRANSFERRED:
            return `${actorName} transferred ownership to ${subjectName}`;
        default:
            return `${actorName} performed an action`;
    }
}

function AuditLogRow({ event }: { event: SerializedMemberEvent }) {
    const ids = useMemo(() => {
        const list = [event.actorUserId];
        if (event.subjectId) list.push(event.subjectId);
        if (event.newOwnerId) list.push(event.newOwnerId);
        return list;
    }, [event]);
    const { subjects } = useSubjectResolver(ids);
    const actor = subjects[0];
    const subject = subjects[1] ?? subjects[0];
    const actorName = actor?.name ?? 'Former member';
    const subjectName = subject?.name ?? event.subjectId?.slice(-6) ?? '';
    const sentence = describeAction(event, actorName, subjectName);
    const iso = event.occurredAt
        ? new Date(Number(event.occurredAt.seconds) * 1000).toISOString()
        : undefined;
    const relative = formatRelativeTime(iso);
    const full = event.occurredAt
        ? formatProtoDateTime({
              seconds: BigInt(event.occurredAt.seconds),
              nanos: event.occurredAt.nanos,
          })
        : '';

    return (
        <div className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/30">
            <SubjectAvatar subject={actor} size="md" />
            <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground">{sentence}</div>
                <div className="text-xs text-muted-foreground mt-0.5" title={full}>
                    {relative}
                    {event.note && <span className="ml-2 italic">"{event.note}"</span>}
                </div>
            </div>
        </div>
    );
}

export function AuditLogPanel({ contentType, contentId }: AuditLogPanelProps) {
    const { events, loading, error, hasMore, loadMore } = useContentAuditLog(contentType, contentId);

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Access history
            </h3>
            {error && (
                <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
            )}
            {loading && events.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : events.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">No events yet.</div>
            ) : (
                <div className="space-y-1">
                    {events.map((e) => (
                        <AuditLogRow key={e.id} event={e} />
                    ))}
                </div>
            )}
            {hasMore && (
                <div className="pt-2 text-center">
                    <Button size="sm" variant="ghost" onClick={loadMore} disabled={loading}>
                        Load more
                    </Button>
                </div>
            )}
        </div>
    );
}
