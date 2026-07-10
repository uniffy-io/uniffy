import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Track } from 'livekit-client';
import { ArrowUpRight } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { getInitials } from '@/components/subject/utils';
import { useCall } from '@/features/calls/components/callContext';
import { useRoomParticipants } from '@/features/calls/hooks/useRoomParticipants';
import { ControlsBar } from '@/features/calls/components/ControlsBar';
import { selectCallSession, selectSessionCall } from '@/features/calls/store/callsSlice';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';

function SelfPreview() {
  const { room } = useCall();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Subscribing to room events keeps the preview in sync with cam toggles.
  useRoomParticipants(room);
  const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  const visible = !!track && !track.isMuted;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  if (!visible) return null;
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="h-11 w-[4.5rem] rounded-md object-cover scale-x-[-1] border border-border/60"
    />
  );
}

export function CallBottomStrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useAppSelector(selectCallSession);
  const sessionCall = useAppSelector(selectSessionCall);
  const channel = useAppSelector((s) =>
    session.channelId
      ? s.chatChannels.channels.find((c) => c.id === session.channelId)
      : undefined,
  );
  const activeChannelId = useAppSelector((s) => s.chatChannels.activeChannelId);
  const { room } = useCall();
  const participants = useRoomParticipants(room);

  const inCall =
    session.status === 'connected' || session.status === 'reconnecting';
  const viewingCallChannel =
    location.pathname.startsWith('/chat') && activeChannelId === session.channelId;

  if (!inCall || viewingCallChannel || !session.channelId) return null;

  const channelName = channel ? getChannelDisplayName(channel) : 'call';
  const roster = sessionCall?.participants ?? [];
  const count = roster.length || participants.length;
  const anySpeaking = participants.some((p) => !p.isLocal && p.isSpeaking);
  const returnToCall = () => navigate(`/chat/${session.channelId}`);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[90] flex h-16 items-center gap-3 border-t border-border bg-card px-3 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
      data-testid="call-bottom-strip"
    >
      <button
        type="button"
        onClick={returnToCall}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Return to call in ${channelName}`}
      >
        <SelfPreview />
        <div className="flex -space-x-1.5 shrink-0">
          {roster.slice(0, 3).map((p) => (
            <span
              key={p.identity}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-card bg-primary/15 text-[10px] font-semibold text-primary"
              title={p.displayName}
            >
              {getInitials(p.displayName)}
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            Live in {channelName} - {count} {count === 1 ? 'person' : 'people'}
          </p>
          <p className="text-xs text-muted-foreground">
            {session.status === 'reconnecting' ? 'Reconnecting...' : 'Click to return to the call'}
          </p>
        </div>
        <div className="flex items-end gap-0.5 h-4 shrink-0" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                'w-0.5 rounded-full bg-emerald-500 transition-all',
                anySpeaking ? 'animate-pulse' : 'opacity-30',
                i === 1 ? 'h-4' : 'h-2.5',
              )}
              style={anySpeaking ? { animationDelay: `${i * 150}ms` } : undefined}
            />
          ))}
        </div>
      </button>

      <ControlsBar compact />

      <button
        type="button"
        onClick={returnToCall}
        className="flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
        data-testid="call-return-button"
      >
        Return <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
