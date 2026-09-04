import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Track } from "livekit-client";
import type { Participant } from "livekit-client";
import {
  ArrowsIn,
  ArrowsOut,
  CaretDown,
  CaretUp,
  PushPinSlash,
  WifiSlash,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";
import { useCall } from "@/features/calls/components/callContext";
import { ControlsBar } from "@/features/calls/components/ControlsBar";
import { ParticipantTile } from "@/features/calls/components/ParticipantTile";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { selectActiveCallForChannel, selectCallSession } from "@/features/calls/store/callsSlice";
import { viewHeightChanged } from "@/features/calls/store/callPreferencesSlice";
import { fetchActiveCall } from "@/features/calls/store/callsThunks";

const SOLO_PROMPT_DELAY_MS = 60_000;
const MIN_HEIGHT_PX = 220;
const MAX_HEIGHT_RATIO = 0.85;

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

function CallGrid({
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
              className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[11px] font-medium text-white hover:bg-black/70"
              data-testid="call-unpin"
            >
              <PushPinSlash size={12} weight="fill" /> Unpin
            </button>
          )}
        </div>
        <div className="flex h-20 gap-2 overflow-x-auto">
          {strip.map(({ participant, target }) => (
            <ParticipantTile
              key={`${target.identity}:${target.source}`}
              participant={participant}
              source={target.source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera}
              displayName={nameFor(participant)}
              onClick={() => togglePin(target)}
              className={cn(
                "aspect-video shrink-0",
                sameTarget(focus, target) && "ring-2 ring-primary/70",
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
        "grid h-full min-h-0 gap-2 auto-rows-fr overflow-y-auto",
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

function ReconnectingChip() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="flex items-center gap-1 rounded bg-yellow-100 dark:bg-yellow-900/30 px-1.5 py-0.5 text-yellow-800 dark:text-yellow-400">
      <WifiSlash size={12} /> Reconnecting...{seconds > 2 ? ` ${seconds}s` : ""}
    </span>
  );
}

function CallViewInner({ channelId }: { channelId: string }) {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCallSession);
  const call = useAppSelector((s) => selectActiveCallForChannel(s, channelId));
  // ?? null: pre-existing persisted state may lack the field (redux-persist
  // replaces the slice wholesale on rehydrate).
  const persistedHeight = useAppSelector((s) => s.callPreferences.viewHeightPx ?? null);
  const { room } = useCall();
  const participants = useRoomParticipants(room);
  const [collapsed, setCollapsed] = useState(false);
  const [showSoloPrompt, setShowSoloPrompt] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [height, setHeight] = useState<number | null>(persistedHeight);
  const containerRef = useRef<HTMLDivElement>(null);

  const rosterByIdentity = useMemo(() => {
    const map = new Map<string, string>();
    call?.participants.forEach((p) => map.set(p.identity, p.displayName));
    return map;
  }, [call]);

  const alone = session.status === "connected" && participants.length === 1;
  useEffect(() => {
    if (!alone) {
      // eslint-disable-next-line react/react-compiler -- reset when someone joins
      setShowSoloPrompt(false);
      return;
    }
    const timer = setTimeout(() => setShowSoloPrompt(true), SOLO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [alone]);

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
      const maxHeight = parentHeight * MAX_HEIGHT_RATIO;
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

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col border-b border-border/60",
        isFullscreen ? "h-full bg-background" : "bg-background/60",
        !isFullscreen && (collapsed ? "h-12" : height === null && "h-[40%] min-h-[220px]"),
      )}
      style={
        !isFullscreen && !collapsed && height !== null
          ? {
              height: `${height}px`,
              minHeight: `${MIN_HEIGHT_PX}px`,
              maxHeight: `${MAX_HEIGHT_RATIO * 100}%`,
            }
          : undefined
      }
      data-testid="call-view"
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live call - {call?.participants.length ?? participants.length} in
          {session.status === "reconnecting" && <ReconnectingChip />}
        </div>
        <div className="flex items-center gap-2">
          {!collapsed && <ControlsBar />}
          {!collapsed && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              data-testid="call-view-fullscreen"
            >
              {isFullscreen ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
            </button>
          )}
          {!isFullscreen && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              aria-label={collapsed ? "Expand call" : "Collapse call"}
              data-testid="call-view-collapse"
            >
              {collapsed ? <CaretDown size={14} /> : <CaretUp size={14} />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="relative flex-1 min-h-0 px-3 pb-3">
          <CallGrid participants={participants} nameFor={(p) => rosterByIdentity.get(p.identity)} />
          {showSoloPrompt && (
            <div className="absolute inset-x-0 bottom-6 flex justify-center">
              <div className={cn(popoverShellClass, "px-3 py-2 text-xs text-muted-foreground")}>
                You are the only one here. The call ends automatically after 5 minutes alone.
                <button
                  type="button"
                  onClick={() => setShowSoloPrompt(false)}
                  className="ml-2 text-primary hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!collapsed && !isFullscreen && (
        <div
          onPointerDown={onResizeStart}
          className="h-1 shrink-0 cursor-row-resize transition-colors hover:bg-primary/40"
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
