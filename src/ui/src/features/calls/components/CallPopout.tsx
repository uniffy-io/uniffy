import { ArrowSquareIn } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CallStatus } from "@/features/calls/components/CallStatus";
import { canPublishInCall, AUDIENCE_MESSAGE } from "@/features/calls/utils/callPublishing";
import { useCallPublishing } from "@/features/calls/hooks/useCallPublishing";
import { CallReactionOverlay } from "@/features/calls/components/CallReactionOverlay";
import { useState } from "react";
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
      <header className="flex items-center justify-between gap-2">
        <CallStatus />
        <Button variant="ghost" size="sm" className="shrink-0" onClick={closePopout}>
          <ArrowSquareIn size={14} />
          Return call to tab
        </Button>
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
        <p role="alert" className="text-center text-sm text-muted-foreground">
          {feedback}
        </p>
      )}
      <footer className="flex flex-col items-center gap-2">
        <ControlsBar chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />
        <p className="text-xs text-muted-foreground">
          Keep original tab open. Closing this window keeps call running.
        </p>
      </footer>
    </div>,
    popoutWindow.document.body,
  );
}
