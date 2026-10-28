import { useEffect, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { callsApi } from "@/features/calls/api/callsApi";
import { selectSessionCall } from "@/features/calls/store/callsSlice";

export function useCallModeration() {
  const call = useAppSelector(selectSessionCall);
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const [result, setResult] = useState({ callId: "", hostId: "", allowed: false });
  const callId = call?.id;
  const hostId = call?.hostUserId;
  useEffect(() => {
    if (!callId || !organizationId) return;
    let cancelled = false;
    void callsApi
      .getCallState({ organizationId, callId })
      .then((state) => {
        if (!cancelled) setResult({ callId, hostId: hostId ?? "", allowed: state.canModerate });
      })
      .catch(() => {
        if (!cancelled) setResult({ callId, hostId: hostId ?? "", allowed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, callId, hostId]);
  return result.callId === callId && result.hostId === hostId && result.allowed;
}
