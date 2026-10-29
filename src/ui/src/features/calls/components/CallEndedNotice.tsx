import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectEndedInfo,
  selectSelfEndedCallId,
  sessionReset,
} from "@/features/calls/store/callsSlice";
import { CALL_END_COPY } from "@/features/calls/utils/callErrors";

/**
 * Toasts why a call ended under the user; their own leave or end-for-all stays silent.
 * `endedInfo` stays latched until the next join because CallProvider keys the
 * teardown of a late-reconnecting room on it.
 */
export function CallEndedNotice() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const endedInfo = useAppSelector(selectEndedInfo);
  const selfEndedCallId = useAppSelector(selectSelfEndedCallId);

  useEffect(() => {
    if (!endedInfo) return;
    const { callId, reason } = endedInfo;
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
