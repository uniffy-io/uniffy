import { CallStatus } from "@/features/calls/components/CallStatus";
import { canPublishInCall, AUDIENCE_MESSAGE } from "@/features/calls/utils/callPublishing";
import { useCallPublishing } from "@/features/calls/hooks/useCallPublishing";
import { CallReactionOverlay } from "@/features/calls/components/CallReactionOverlay";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { CallChat } from "@/features/calls/components/CallChat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Track } from "livekit-client";
import type { Participant } from "livekit-client";
import { ArrowSquareIn, Users, CaretDown, CaretUp, PushPinSlash } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { PaneIconButton } from "@/components/ui/pane-header";
import { Button } from "@/components/ui/button";
import { useCall } from "@/features/calls/components/callContext";
import { CallParticipants } from "@/features/calls/components/CallParticipants";
import { ControlsBar } from "@/features/calls/components/ControlsBar";
import { ParticipantTile } from "@/features/calls/components/ParticipantTile";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { selectActiveCallForChannel, selectCallSession } from "@/features/calls/store/callsSlice";
import { viewHeightChanged } from "@/features/calls/store/callPreferencesSlice";
import { fetchActiveCall } from "@/features/calls/store/callsThunks";

const MIN_HEIGHT_PX = 220;
// Kept below the call for the channel header, a few messages and the composer,
// which docks absolutely over the message list and would otherwise cover the controls.
const CHANNEL_RESERVE_PX = 280;

interface FocusTarget {
  identity: string;
  source: "camera" | "screen";
}

function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-3";
  return "grid-cols-4";
}

function sameTarget(a: FocusTarget | null, b: FocusTarget): boolean {
  return !!a && a.identity === b.identity && a.source === b.source;
}

export function CallGrid({
  participants,
  nameFor,
}: {
  participants: Participant[];
  nameFor: (p: Participant) => string | undefined;
}) {
  const screenShares = participants.filter(
    (p) => !!p.getTrackPublication(Track.Source.ScreenShare)?.track,
  );
  const [pinned, setPinned] = useState<FocusTarget | null>(null);

  const pinnedValid =
    pinned !== null &&
    participants.some(
      (p) =>
        p.identity === pinned.identity &&
        (pinned.source === "camera" || !!p.getTrackPublication(Track.Source.ScreenShare)?.track),
    );

  // Pinned target wins; otherwise an active screen share auto-focuses.
  const focus: FocusTarget | null = pinnedValid
    ? pinned
    : screenShares.length > 0
      ? { identity: screenShares[0].identity, source: "screen" }
      : null;

  const togglePin = useCallback((target: FocusTarget) => {
    setPinned((prev) => (sameTarget(prev, target) ? null : target));
  }, []);

  if (focus) {
    const focusedParticipant = participants.find((p) => p.identity === focus.identity);
    if (!focusedParticipant) return null;
    const strip: { participant: Participant; target: FocusTarget }[] = [
      ...screenShares.map((p) => ({
        participant: p,
        target: { identity: p.identity, source: "screen" as const },
      })),
      ...participants.map((p) => ({
        participant: p,
        target: { identity: p.identity, source: "camera" as const },
      })),
    ];
    return (
      <div className="flex h-full flex-col gap-2 min-h-0">
        <div className="relative flex-1 min-h-0">
          <ParticipantTile
            participant={focusedParticipant}
            source={focus.source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera}
            displayName={nameFor(focusedParticipant)}
            className="h-full"
            zoomable={focus.source === "screen"}
          />
          {pinnedValid && (
            <button
              type="button"
              onClick={() => setPinned(null)}
              className="focus-ring absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-[11px] font-medium text-white hover:bg-black/70 pointer-coarse:min-h-11"
              data-testid="call-unpin"
            >
              <PushPinSlash size={12} weight="fill" /> Unpin
            </button>
          )}
        </div>
        {/* The filmstrip needs room the phone-height stage does not have; there the stage takes it all. */}
        <div className="hidden h-20 shrink-0 gap-2 overflow-x-auto p-0.5 md:flex">
          {strip.map(({ participant, target }) => (
            <ParticipantTile
              key={`${target.identity}:${target.source}`}
              participant={participant}
              source={target.source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera}
              displayName={nameFor(participant)}
              onClick={() => togglePin(target)}
              compact
              className={cn(
                "aspect-video shrink-0",
                sameTarget(focus, target) && "shadow-edge-primary",
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0 gap-2 auto-rows-fr overflow-y-auto p-0.5",
        gridClassFor(participants.length),
      )}
    >
      {participants.map((p) => (
        <ParticipantTile
          key={p.identity}
          participant={p}
          displayName={nameFor(p)}
          onClick={() => togglePin({ identity: p.identity, source: "camera" })}
        />
      ))}
    </div>
  );
}

function CallViewInner({ channelId }: { channelId: string }) {
  const { isMobile } = useBreakpoint();
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCallSession);
  const call = useAppSelector((s) => selectActiveCallForChannel(s, channelId));
  // ?? null: pre-existing persisted state may lack the field (redux-persist
  // replaces the slice wholesale on rehydrate).
  const persistedHeight = useAppSelector((s) => s.callPreferences.viewHeightPx ?? null);
  const { room, popoutWindow, closePopout } = useCall();
  const participants = useRoomParticipants(room);
  const { canPublish } = useCallPublishing();
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [height, setHeight] = useState<number | null>(persistedHeight);
  const containerRef = useRef<HTMLDivElement>(null);

  const rosterByIdentity = useMemo(() => {
    const map = new Map<string, string>();
    call?.participants.forEach((p) => map.set(p.identity, p.displayName));
    return map;
  }, [call]);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const startY = e.clientY;
      const startHeight = el.getBoundingClientRect().height;
      const parentHeight = el.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
      const maxHeight = Math.max(MIN_HEIGHT_PX, parentHeight - CHANNEL_RESERVE_PX);
      let latest = startHeight;
      const onMove = (ev: PointerEvent) => {
        latest = Math.min(Math.max(startHeight + (ev.clientY - startY), MIN_HEIGHT_PX), maxHeight);
        setHeight(latest);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        // eslint-disable-next-line react/react-compiler -- onUp is local to this drag, not a hook dependency
        window.removeEventListener("pointerup", onUp);
        dispatch(viewHeightChanged(Math.round(latest)));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [dispatch],
  );

  const resizable = !isMobile && !collapsed && !isFullscreen;

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col",
        // The resize handle draws the seam itself when present.
        !resizable && "border-b border-border-strong",
        isFullscreen ? "h-full bg-background" : "bg-background/60",
        !isFullscreen &&
          (collapsed ? "h-12" : isMobile ? "h-auto shrink-0" : height === null && "h-[40%]"),
      )}
      style={
        !isMobile && !isFullscreen && !collapsed
          ? {
              height: height === null ? undefined : `${height}px`,
              minHeight: `${MIN_HEIGHT_PX}px`,
              maxHeight: `calc(100% - ${CHANNEL_RESERVE_PX}px)`,
            }
          : undefined
      }
      data-testid="call-view"
    >
      {participantsOpen && <CallParticipants onClose={() => setParticipantsOpen(false)} />}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <CallStatus />
        <div className="flex shrink-0 items-center gap-1">
          <PaneIconButton
            onClick={() => setParticipantsOpen(true)}
            className="gap-1.5 px-2 text-xs"
            aria-label="Participants"
            title="Participants"
            data-testid="call-participants-button"
          >
            <Users size={16} />
            <span className="tabular-nums">{call?.participants.length ?? participants.length}</span>
          </PaneIconButton>
          {!isFullscreen && (
            <PaneIconButton
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Expand call" : "Collapse call"}
              title={collapsed ? "Expand call" : "Collapse call"}
              data-testid="call-view-collapse"
            >
              {collapsed ? <CaretDown size={16} /> : <CaretUp size={16} />}
            </PaneIconButton>
          )}
        </div>
      </div>

      {!collapsed && !canPublish && (
        <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
          {AUDIENCE_MESSAGE}
        </p>
      )}
      {!collapsed && (
        <div
          className={cn(
            "flex min-h-0 flex-col gap-3 px-3 pb-3 sm:flex-row",
            isMobile && !isFullscreen ? "h-36 shrink-0" : "flex-1",
          )}
        >
          <div className="relative min-h-0 min-w-0 flex-1">
            {popoutWindow ? (
              <div className="flex h-full items-center justify-center">
                <Button variant="outline" size="md" onClick={closePopout}>
                  <ArrowSquareIn size={14} />
                  Return call to tab
                </Button>
              </div>
            ) : (
              <CallGrid
                participants={participants.filter((p) =>
                  canPublishInCall(call, p.identity.split(":")[0]),
                )}
                nameFor={(p) => rosterByIdentity.get(p.identity)}
              />
            )}
            {!popoutWindow && <CallReactionOverlay />}
          </div>
          {isFullscreen && chatOpen && session.channelId && (
            <div className="h-1/2 min-h-48 sm:h-full sm:w-80">
              <CallChat
                key={session.channelId}
                channelId={session.channelId}
                onClose={() => setChatOpen(false)}
              />
            </div>
          )}
        </div>
      )}

      {!collapsed && !popoutWindow && (
        <div className="flex shrink-0 justify-center px-2 pb-3 pt-1">
          <ControlsBar
            chatOpen={chatOpen}
            onToggleChat={isFullscreen ? () => setChatOpen(!chatOpen) : undefined}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        </div>
      )}

      {resizable && (
        <div
          onPointerDown={onResizeStart}
          className="relative h-1 shrink-0 cursor-row-resize before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border-strong before:transition-colors hover:before:bg-primary/60 active:before:h-0.5 active:before:bg-primary"
          data-testid="call-view-resize-handle"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * Mounted for every open channel: keeps the channel's active-call snapshot
 * fresh and renders the embedded call section while this channel's call is
 * the user's live session.
 */
export function CallSection({ channelId }: { channelId: string }) {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCallSession);

  useEffect(() => {
    void dispatch(fetchActiveCall(channelId));
  }, [dispatch, channelId]);

  const inSessionHere =
    session.channelId === channelId &&
    (session.status === "connected" ||
      session.status === "connecting" ||
      session.status === "reconnecting");

  if (!inSessionHere) return null;
  return <CallViewInner channelId={channelId} />;
}
