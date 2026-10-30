import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectEndedInfo,
  selectSelfEndedCallId,
  sessionReset,
} from "@/features/calls/store/callsSlice";
import { CALL_END_COPY } from "@/features/calls/utils/callErrors";

export function CallEndedNotice() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const endedInfo = useAppSelector(selectEndedInfo);
  const selfEndedCallId = useAppSelector(selectSelfEndedCallId);
  const lastNotice = useRef<string | null>(null);

  useEffect(() => {
    if (!endedInfo) {
      lastNotice.current = null;
      return;
    }
    const { callId, reason } = endedInfo;
    const notice = `${callId}:${reason ?? "UNKNOWN"}`;
    if (lastNotice.current === notice) return;
    lastNotice.current = notice;
    // Keep endedInfo for late room teardown without replaying its notice on navigation.
    dispatch(sessionReset());
    if (callId === selfEndedCallId) return;
    // A null reason resolves through GetCallState; the shared id updates this toast in place.
    toast.info(CALL_END_COPY[reason ?? "UNKNOWN"], {
      id: `call-ended:${callId}`,
      duration: 8_000,
      action: { label: "View summary", onClick: () => navigate(`/calls/${callId}`) },
    });
  }, [endedInfo, selfEndedCallId, dispatch, navigate]);

  return null;
}
