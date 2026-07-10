import { useEffect } from 'react';
import { Phone, PhoneDisconnect } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { getInitials } from '@/components/subject/utils';
import {
  prejoinOpened,
  ringDismissed,
  selectCallSession,
  selectRingInvites,
} from '@/features/calls/store/callsSlice';
import { selectCallPreferences } from '@/features/calls/store/callPreferencesSlice';
import { declineCall } from '@/features/calls/store/callsThunks';
import type { RingInvite } from '@/features/calls/types';

const RING_FALLBACK_TIMEOUT_MS = 30_000;

/**
 * Two-tone ringtone synthesized with WebAudio; shipping an audio asset would
 * be dead weight and a CDN fetch is off the table. Autoplay policy can still
 * block the AudioContext until first interaction; the visual toast carries it.
 */
function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(gain);
    osc.start();

    let stopped = false;
    const ringOnce = (t: number) => {
      osc.frequency.setValueAtTime(440, t);
      gain.gain.setValueAtTime(0.12, t);
      osc.frequency.setValueAtTime(554, t + 0.35);
      gain.gain.setValueAtTime(0.12, t + 0.35);
      gain.gain.setValueAtTime(0, t + 0.7);
    };
    const loop = () => {
      if (stopped) return;
      ringOnce(ctx.currentTime + 0.05);
      timer = setTimeout(loop, 2_000);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    void ctx.resume().then(loop).catch(() => {});

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        osc.stop();
      } catch {
        // Already stopped.
      }
      void ctx.close();
    };
  }, [active]);
}

function InviteCard({ invite }: { invite: RingInvite }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const expiresIn = invite.expiresAt
      ? new Date(invite.expiresAt).getTime() - Date.now()
      : RING_FALLBACK_TIMEOUT_MS;
    const timer = setTimeout(
      () => dispatch(ringDismissed(invite.callId)),
      Math.max(1_000, expiresIn),
    );
    return () => clearTimeout(timer);
  }, [dispatch, invite.callId, invite.expiresAt]);

  const subtitle =
    invite.callType === 'DIRECT'
      ? 'Incoming call'
      : `Incoming call in ${invite.channelName}`;

  return (
    <div
      className="pointer-events-auto flex w-80 items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-2xl"
      data-testid="call-invite-toast"
    >
      {invite.callerAvatarUrl ? (
        <img
          src={invite.callerAvatarUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {getInitials(invite.callerName)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{invite.callerName}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={() => void dispatch(declineCall(invite.callId))}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
        aria-label="Decline call"
        data-testid="call-invite-decline"
      >
        <PhoneDisconnect size={16} weight="fill" />
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch(ringDismissed(invite.callId));
          dispatch(prejoinOpened(invite.channelId));
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
        aria-label="Accept call"
        data-testid="call-invite-accept"
      >
        <Phone size={16} weight="fill" />
      </button>
    </div>
  );
}

export function CallInviteToasts() {
  const invites = useAppSelector(selectRingInvites);
  const session = useAppSelector(selectCallSession);
  const preferences = useAppSelector(selectCallPreferences);
  const inCall = session.status !== 'idle';

  useRingtone(invites.length > 0 && !inCall && preferences.ringtoneEnabled);

  if (invites.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[110] flex flex-col items-center gap-2">
      {invites.map((invite) => (
        <InviteCard key={invite.callId} invite={invite} />
      ))}
    </div>
  );
}
