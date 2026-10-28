import { createPortal } from "react-dom";
import { useAppSelector } from "@/app/hooks";
import { useCall } from "@/features/calls/components/callContext";
import { CallGrid } from "@/features/calls/components/CallView";
import { ControlsBar } from "@/features/calls/components/ControlsBar";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { selectCallSession, selectSessionCall } from "@/features/calls/store/callsSlice";

export function CallPopout() {
  const { room, popoutWindow, closePopout } = useCall();
  const participants = useRoomParticipants(room);
  const call = useAppSelector(selectSessionCall);
  const session = useAppSelector(selectCallSession);
  const feedback = useAppSelector((s) => s.calls.feedback);
  if (!popoutWindow || popoutWindow.closed || !session.callId) return null;
  return createPortal(
    <div className="flex h-screen flex-col gap-3 p-3" data-testid="call-popout">
      <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{session.status === "reconnecting" ? "Reconnecting..." : "Live call"}</span>
        <button
          type="button"
          className="min-h-11 text-primary hover:underline"
          onClick={closePopout}
        >
          Return to tab
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <CallGrid
          participants={participants}
          nameFor={(p) =>
            call?.participants.find((member) => member.identity === p.identity)?.displayName
          }
        />
      </div>
      {feedback && (
        <p role="alert" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      )}
      <footer className="flex flex-col items-center gap-2 [&_button]:size-11">
        <ControlsBar compact />
        <p className="text-xs text-muted-foreground">
          Keep original tab open. Closing this window keeps call running.
        </p>
      </footer>
    </div>,
    popoutWindow.document.body,
  );
}
