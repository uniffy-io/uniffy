import { useEffect, useState } from "react";
import { WifiSlash, X } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { CallModeBadge } from "@/features/calls/components/CallModeBadge";
import { useCall } from "@/features/calls/components/callContext";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { selectCallSession } from "@/features/calls/store/callsSlice";

const SOLO_NOTICE_DELAY_MS = 60_000;

function ReconnectingChip() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span
      role="status"
      className="flex shrink-0 items-center gap-1 rounded-md bg-yellow-100 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    >
      <WifiSlash size={12} /> Reconnecting...{seconds > 2 ? ` ${seconds}s` : ""}
    </span>
  );
}

function SoloNotice() {
  const { room } = useCall();
  const participants = useRoomParticipants(room);
  const status = useAppSelector((s) => s.calls.session.status);
  const alone = status === "connected" && participants.length === 1;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!alone) {
      // eslint-disable-next-line react/react-compiler -- reset when someone joins
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SOLO_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [alone]);
  if (!visible) return null;
  return (
    <span
      role="status"
      className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-0.5 pl-1.5 pr-0.5 text-foreground/80"
      title="You are the only one here. The call ends automatically after 5 minutes alone."
    >
      <span className="truncate">Only you here · ends after 5 min alone</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="focus-ring flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        aria-label="Dismiss"
      >
        <X size={10} weight="bold" />
      </button>
    </span>
  );
}

/** Live state shown at the head of every call surface: mode, reconnects, and the solo auto-end warning. */
export function CallStatus() {
  const session = useAppSelector(selectCallSession);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="size-2 shrink-0 rounded-full bg-green-500" />
      <span className="whitespace-nowrap">Live call</span>
      <CallModeBadge />
      {session.status === "reconnecting" && <ReconnectingChip />}
      <SoloNotice />
    </div>
  );
}
