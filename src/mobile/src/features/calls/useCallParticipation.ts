import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { getDeviceId } from "@core/auth/deviceId";
import { CallReaction } from "@uniffy/proto/calls/v1/calls_pb";
import { useCall } from "@features/calls/CallContext";
import { callsApi } from "@features/calls/callsApi";
import { participantToPlain } from "@features/calls/callsSerializer";
import { applyParticipantEvent } from "@features/calls/useCallsState";
import { callErrorMessage } from "@features/calls/callErrors";

export function useCallParticipation() {
  const { organizationId } = useAuth();
  const { session, showFeedback } = useCall();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const act = async (raised: boolean | null, identity?: string, reaction?: CallReaction) => {
    if (pending || !organizationId || !session.callId || !session.channelId) return;
    const callId = session.callId;
    const channelId = session.channelId;
    setPending(true);
    try {
      const request = { organizationId, callId, deviceId: await getDeviceId() };
      if (raised !== null) {
        const res = await callsApi.setHandRaised({ ...request, raised, identity });
        if (res.participant)
          applyParticipantEvent(
            qc,
            organizationId,
            channelId,
            callId,
            participantToPlain(res.participant),
            "state",
          );
      } else if (reaction !== undefined) await callsApi.sendCallReaction({ ...request, reaction });
    } catch (error) {
      showFeedback(callErrorMessage(error));
    } finally {
      setPending(false);
    }
  };
  return {
    pending,
    setHand: (raised: boolean, identity?: string) => act(raised, identity),
    react: (reaction: CallReaction) => act(null, undefined, reaction),
  };
}
