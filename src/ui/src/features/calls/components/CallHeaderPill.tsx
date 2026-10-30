import { CallPopoutButton } from "@/features/calls/components/CallPopoutButton";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, PhoneDisconnect } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarById } from "@/components/subject";
import { Button } from "@/components/ui/button";
import { useCall } from "@/features/calls/components/callContext";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { ControlsBar } from "@/features/calls/components/ControlsBar";
import { selectCallSession, selectSessionCall } from "@/features/calls/store/callsSlice";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";

function LiveDot({ speaking, reconnecting }: { speaking: boolean; reconnecting: boolean }) {
  const color = reconnecting ? "bg-amber-500" : "bg-green-500";
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span
        className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-75",
          color,
          (reconnecting || speaking) && "motion-safe:animate-ping",
        )}
      />
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

/**
 * Live-call chrome that lives in the top nav while the user is in a call but
 * looking at another surface. Returns null on the call's own channel, where the
 * in-channel controls take over.
 */
export function CallHeaderPill() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useAppSelector(selectCallSession);
  const sessionCall = useAppSelector(selectSessionCall);
  const channel = useAppSelector((s) =>
    session.channelId ? s.chatChannels.byId[session.channelId] : undefined,
  );
  const activeChannelId = useAppSelector((s) => s.chatChannels.activeChannelId);
  const { room, leaveCurrentCall } = useCall();
  const participants = useRoomParticipants(room);

  const inCall = session.status === "connected" || session.status === "reconnecting";
  const viewingCallChannel =
    location.pathname.startsWith("/chat") && activeChannelId === session.channelId;

  if (!inCall || viewingCallChannel || !session.channelId) return null;

  const channelName = channel ? getChannelDisplayName(channel) : "call";
  const roster = sessionCall?.participants ?? [];
  // The roster has one row per device; the stack shows people.
  const people = [...new Map(roster.map((p) => [p.userId, p])).values()];
  const count = roster.length || participants.length;
  const anySpeaking = participants.some((p) => !p.isLocal && p.isSpeaking);
  const returnToCall = () => navigate(`/chat/${session.channelId}`);
  const reconnecting = session.status === "reconnecting";

  return (
    <>
      <div className="hidden md:flex items-center gap-1" data-testid="call-header-pill">
        <button
          type="button"
          onClick={returnToCall}
          className="focus-ring group flex h-7 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-1.5 transition-colors hover:bg-primary/15"
          aria-label={`Return to call in ${channelName}`}
          data-testid="call-return-button"
        >
          <LiveDot speaking={anySpeaking} reconnecting={reconnecting} />
          <div className="flex -space-x-1.5 shrink-0">
            {people.slice(0, 3).map((p) => (
              <SubjectAvatarById
                key={p.userId}
                userId={p.userId}
                displayName={p.displayName}
                avatarUrl={p.avatarUrl ?? undefined}
                size="xs"
                bordered
              />
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
          <ArrowUpRight
            size={12}
            className="text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </button>

        <ControlsBar compact />
        <CallPopoutButton />
      </div>

      <div className="flex md:hidden items-center gap-1">
        <button
          type="button"
          onClick={returnToCall}
          className="focus-ring flex h-7 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-foreground"
          aria-label={`Return to call in ${channelName}`}
        >
          <LiveDot speaking={anySpeaking} reconnecting={reconnecting} />
          {reconnecting ? "Reconnecting" : "Live"}
        </button>
        <Button
          variant="destructive"
          size="icon"
          onClick={() => void leaveCurrentCall()}
          className="rounded-md"
          aria-label="Leave call"
        >
          <PhoneDisconnect size={14} weight="fill" />
        </Button>
      </div>
    </>
  );
}
