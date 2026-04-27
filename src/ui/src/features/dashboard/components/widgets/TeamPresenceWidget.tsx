/**
 * TeamPresenceWidget - Shows online team members
 *
 * Displays a SubjectAvatarStack for compact view with expandable list.
 * Uses PresenceIndicator on each avatar.
 */

import { useMemo, useState } from 'react';
import { Users, CaretDown, CaretUp } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { WidgetCard, EmptyWidget } from '@/features/dashboard/components/widgets/WidgetCard';
import { SubjectAvatarStack } from '@/components/subject/SubjectAvatarStack';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import { PresenceIndicator } from '@/components/subject/PresenceIndicator';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

export function TeamPresenceWidget() {
  const [expanded, setExpanded] = useState(false);
  const { isMobile } = useBreakpoint();

  const presenceStatuses = useAppSelector((state) => state.presence?.statuses ?? {});
  const customStatuses = useAppSelector((state) => state.presence?.customStatuses ?? {});
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? '');

  const onlineUserIds = useMemo(() => {
    return Object.entries(presenceStatuses)
      .filter(([userId, status]) => {
        if (userId === currentUserId) return false;
        return status === 'online' || status === 'away' || status === 'dnd';
      })
      .map(([userId]) => userId);
  }, [presenceStatuses, currentUserId]);

  const { subjects } = useSubjectResolver(onlineUserIds);

  if (isMobile) return null;

  const isEmpty = onlineUserIds.length === 0;

  return (
    <WidgetCard
      title="Team Online"
      icon={Users}
      colSpan={1}
      compact
      priority={2}
    >
      {isEmpty ? (
        <EmptyWidget
          icon={Users}
          title="No one online"
          description="Your team members will appear here when they are online"
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SubjectAvatarStack
              subjectIds={onlineUserIds}
              maxDisplay={8}
              size="sm"
            />
            <span className="text-xs text-muted-foreground ml-2 shrink-0">
              {onlineUserIds.length} online
            </span>
          </div>

          {onlineUserIds.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
              {expanded ? 'Collapse' : 'Show all'}
            </button>
          )}

          {expanded && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {subjects.map((subject) => {
                const status = presenceStatuses[subject.id] ?? 'offline';
                const custom = customStatuses[subject.id];
                return (
                  <div key={subject.id} className="flex items-center gap-2.5 py-1">
                    <div className="relative">
                      <SubjectAvatar subject={subject} size="sm" />
                      <PresenceIndicator status={status} size="sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">
                        {subject.name}
                      </p>
                      {custom?.text && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {custom.text}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
