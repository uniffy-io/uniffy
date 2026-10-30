import { useEffect } from "react";
import { toast } from "sonner";
import { useCall } from "@/features/calls/components/callContext";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { feedbackChanged } from "@/features/calls/store/callsSlice";

const TOAST_ID = "call-feedback";

export function CallFeedback() {
  const message = useAppSelector((s) => s.calls.feedback);
  const dispatch = useAppDispatch();
  const { room } = useCall();
  const participants = useRoomParticipants(room);
  const status = useAppSelector((s) => s.calls.session.status);

  // The pop-out window renders the same message inline, so the store keeps it
  // until this toast is dismissed or times out.
  useEffect(() => {
    if (!message) {
      toast.dismiss(TOAST_ID);
      return;
    }
    const clear = () => dispatch(feedbackChanged(null));
    toast.info(message, { id: TOAST_ID, duration: 8_000, onDismiss: clear, onAutoClose: clear });
  }, [message, dispatch]);

  return (
    <span role="status" className="sr-only">
      {status === "reconnecting"
        ? "Reconnecting to the call."
        : status === "connected" && participants.length === 1
          ? "You are the only person in the call."
          : ""}
    </span>
  );
}
