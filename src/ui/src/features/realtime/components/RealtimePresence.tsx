import { useMemo } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { useDocAwareness } from '@/features/realtime';
import { PeerAvatar } from '@/features/realtime/components/PeerAvatar';
import { cn } from '@/shared/utils/cn';

interface AwarenessUser {
  id?: string | null;
  name?: string;
  color?: string;
  avatarUrl?: string | null;
  hasAvatar?: boolean;
}

interface AwarenessPayload {
  user?: AwarenessUser;
}

interface RealtimePresenceProps {
  awareness: Awareness | null;
  /** Maximum avatars shown before collapsing the rest into ``+N``. */
  max?: number;
  /** Include the local user in the stack (with a subtle "You" marker). */
  includeSelf?: boolean;
  localUserId?: string | null;
  localUserName?: string | null;
  localUserColor?: string | null;
  localHasAvatar?: boolean;
  className?: string;
}

interface Participant {
  key: string;
  userId: string | null;
  name: string;
  color: string;
  hasAvatar: boolean;
  isSelf: boolean;
}

/**
 * Compact avatar stack of active realtime editors on this doc, sourced
 * from the doc's `Awareness`. `includeSelf` prepends the local user with
 * a faint outline so a single-tab editor still sees the affordance.
 */
export function RealtimePresence({
  awareness,
  max = 4,
  includeSelf = true,
  localUserId = null,
  localUserName,
  localUserColor,
  localHasAvatar = false,
  className,
}: RealtimePresenceProps) {
  const peers = useDocAwareness<AwarenessPayload>(awareness);

  const participants = useMemo<Participant[]>(() => {
    const out: Participant[] = [];
    // Dedupe by user.id so a user with N tabs (or a peer still in
    // awareness' GC window after refresh) shows up exactly once.
    // Anonymous peers (no user.id) are deduped by clientId only.
    const seenUserIds = new Set<string>();
    if (includeSelf && (localUserName || localUserColor)) {
      if (localUserId) seenUserIds.add(localUserId);
      out.push({
        key: 'self',
        userId: localUserId,
        name: localUserName ?? 'You',
        color: localUserColor ?? '#6366f1',
        hasAvatar: localHasAvatar,
        isSelf: true,
      });
    }
    for (const peer of peers) {
      const user = peer.state?.user;
      const userId = user?.id ?? null;
      if (userId) {
        if (seenUserIds.has(userId)) continue;
        seenUserIds.add(userId);
      }
      out.push({
        key: userId ?? String(peer.clientId),
        userId,
        name: user?.name ?? 'Anonymous',
        color: user?.color ?? '#6366f1',
        hasAvatar: Boolean(user?.hasAvatar),
        isSelf: false,
      });
    }
    return out;
  }, [peers, includeSelf, localUserId, localUserName, localUserColor, localHasAvatar]);

  if (participants.length === 0) return null;

  const visible = participants.slice(0, max);
  const overflow = participants.length - visible.length;

  const tooltipNames = participants
    .map((p) => (p.isSelf ? `${p.name} (you)` : p.name))
    .join(', ');

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      title={`${participants.length} active: ${tooltipNames}`}
      aria-label={`${participants.length} active editors`}
    >
      <div className="flex -space-x-1.5">
        {visible.map((participant) => (
          <PeerAvatar
            key={participant.key}
            userId={participant.userId}
            name={participant.name}
            color={participant.color}
            hasAvatar={participant.hasAvatar}
            sizeClass="h-5 w-5 text-[10px]"
            className={cn(
              'ring-2 ring-card',
              participant.isSelf && 'ring-card/60',
            )}
            title={participant.isSelf ? `${participant.name} (you)` : participant.name}
          />
        ))}
        {overflow > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
