import { CallModeControl } from "@/features/calls/components/CallModeControl";
import { canPublishInCall, AUDIENCE_MESSAGE } from "@/features/calls/utils/callPublishing";
import { useCallPublishing } from "@/features/calls/hooks/useCallPublishing";
import { CallReactionOverlay } from "@/features/calls/components/CallReactionOverlay";
import { useState } from "react";
import { CallParticipation } from "@/features/calls/components/CallParticipation";
import { CallChat } from "@/features/calls/components/CallChat";
import { createPortal } from "react-dom";
import { useAppSelector } from "@/app/hooks";
import { useCall } from "@/features/calls/components/callContext";
import { CallGrid } from "@/features/calls/components/CallView";
import { ControlsBar } from "@/features/calls/components/ControlsBar";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { selectCallSession, selectSessionCall } from "@/features/calls/store/callsSlice";

export function CallPopout() {
  const { canPublish } = useCallPublishing();
  const [chatOpen, setChatOpen] = useState(false);
  const { room, popoutWindow, closePopout } = useCall();
  const participants = useRoomParticipants(room);
  const call = useAppSelector(selectSessionCall);
  const session = useAppSelector(selectCallSession);
  const feedback = useAppSelector((s) => s.calls.feedback);
  if (!popoutWindow || popoutWindow.closed || !session.callId) return null;
  return createPortal(
    <div className="flex h-dvh flex-col gap-3 p-3" data-testid="call-popout">
      <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <CallModeControl />
        <span>{session.status === "reconnecting" ? "Reconnecting..." : "Live call"}</span>
        <button
          type="button"
          className="min-h-11 text-primary hover:underline"
          onClick={closePopout}
        >
          Return to tab
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        <div className="relative min-h-24 min-w-0 flex-1">
          <CallGrid
            participants={participants.filter((p) =>
              canPublishInCall(call, p.identity.split(":")[0]),
            )}
            nameFor={(p) =>
              call?.participants.find((member) => member.identity === p.identity)?.displayName
            }
          />
          <CallReactionOverlay />
        </div>
        {chatOpen && session.channelId && (
          <div className="h-1/2 min-h-48 sm:h-full sm:w-80">
            <CallChat
              key={session.channelId}
              channelId={session.channelId}
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>
      {!canPublish && (
        <p role="status" className="text-xs text-muted-foreground">
          {AUDIENCE_MESSAGE}
        </p>
      )}
      {feedback && (
        <p role="alert" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      )}
      <footer className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <CallParticipation chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />
          <div className="[&_button]:size-11 md:[&_button]:size-9">
            <ControlsBar compact />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Keep original tab open. Closing this window keeps call running.
        </p>
      </footer>
    </div>,
    popoutWindow.document.body,
  );
}
