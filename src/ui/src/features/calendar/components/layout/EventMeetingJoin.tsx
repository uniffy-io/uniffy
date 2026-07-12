import { useState, useEffect } from 'react';
import { VideoCamera, ArrowSquareOut } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { prejoinOpened, selectActiveCallForChannel } from '@/features/calls/store/callsSlice';
import { chatApi } from '@/features/chat/api/chatApi';
import { navigateTo } from '@/shared/utils/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import type { RootState } from '@/app/store';

interface EventMeetingJoinProps {
  channelId: string;
}

/**
 * Online-meeting block for a channel-bound event: resolves the channel name,
 * gates join on access, and shows live state. Join rides the global pre-join
 * modal, so no navigation is needed to enter the call.
 */
export function EventMeetingJoin({ channelId }: EventMeetingJoinProps) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const activeCall = useAppSelector((s: RootState) => selectActiveCallForChannel(s, channelId));
  const [channelName, setChannelName] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while re-resolving a new channel binding
    setChannelName(null);
    setHasAccess(null);
    chatApi
      .getChannel({ organizationId, channelId })
      .then((res) => {
        if (cancelled) return;
        const ch = res.channel;
        setChannelName(ch ? ch.customName?.trim() || ch.name : null);
        setHasAccess(true);
      })
      .catch(() => {
        if (!cancelled) setHasAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, organizationId]);

  const isLive = !!activeCall;
  const participantCount = activeCall?.participants.length ?? 0;
  const label = channelName ?? 'Online meeting';

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <VideoCamera size={16} weight="duotone" className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
        {isLive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
            </span>
            Live{participantCount > 0 ? ` · ${participantCount}` : ''}
          </span>
        )}
      </div>

      {hasAccess === false ? (
        <p className="text-xs text-muted-foreground">You do not have access to this channel.</p>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={hasAccess !== true}
            onClick={() => dispatch(prejoinOpened(channelId))}
          >
            <VideoCamera size={14} weight="fill" />
            Join meeting
          </Button>
          <button
            type="button"
            onClick={() => navigateTo(`/chat/${channelId}`)}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground',
              'hover:text-foreground transition-colors',
            )}
          >
            <ArrowSquareOut size={14} />
            Open channel
          </button>
        </div>
      )}
    </div>
  );
}
