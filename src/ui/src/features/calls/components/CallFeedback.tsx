import { useCall } from "@/features/calls/components/callContext";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { feedbackChanged } from "@/features/calls/store/callsSlice";

export function CallFeedback() {
  const message = useAppSelector((s) => s.calls.feedback);
  const dispatch = useAppDispatch();
  const { room } = useCall();
  const participants = useRoomParticipants(room);
  const status = useAppSelector((s) => s.calls.session.status);
  return (
    <>
      <span role="status" className="sr-only">
        {status === "reconnecting"
          ? "Reconnecting to the call."
          : status === "connected" && participants.length === 1
            ? "You are the only person in the call."
            : ""}
      </span>
      {message && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            popoverShellClass,
            "fixed bottom-4 left-1/2 z-[120] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 p-3",
          )}
        >
          <p className="flex-1 text-sm text-foreground">{message}</p>
          <Button variant="ghost" onClick={() => dispatch(feedbackChanged(null))}>
            Dismiss
          </Button>
        </div>
      )}
    </>
  );
}
