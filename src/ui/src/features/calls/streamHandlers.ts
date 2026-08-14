import { ChatEventType } from "@uniffy/proto/chat/v1/chat_stream_pb";
import type { ChatEvent } from "@uniffy/proto/chat/v1/chat_stream_pb";
import {
  callToPlain,
  participantToPlain,
  ringPayloadToInvite,
} from "@/features/calls/api/callsConverters";
import {
  callUpserted,
  callEnded,
  participantUpserted,
  participantLeft,
  hostChanged,
  ringReceived,
} from "@/features/calls/store/callsSlice";
import type { AppDispatch } from "@/app/store";

/**
 * Call events apply globally (channel indicators, ringing, the session the
 * user is in), never filtered to the active channel. Returns true when the
 * event was a call event and is fully handled.
 */
export function handleCallStreamEvent(ce: ChatEvent, dispatch: AppDispatch): boolean {
  switch (ce.eventType) {
    case ChatEventType.CALL_STARTED: {
      if (ce.payload.case === "callLifecycle" && ce.payload.value.call) {
        dispatch(callUpserted(callToPlain(ce.payload.value.call)));
      }
      return true;
    }
    case ChatEventType.CALL_ENDED: {
      if (ce.payload.case === "callLifecycle" && ce.payload.value.call) {
        const call = callToPlain(ce.payload.value.call);
        dispatch(callEnded({ callId: call.id, channelId: call.channelId, reason: call.endReason }));
      }
      return true;
    }
    case ChatEventType.CALL_PARTICIPANT_JOINED:
    case ChatEventType.CALL_PARTICIPANT_STATE: {
      if (ce.payload.case === "callParticipant" && ce.payload.value.participant) {
        dispatch(
          participantUpserted({
            callId: ce.payload.value.callId,
            participant: participantToPlain(ce.payload.value.participant),
          }),
        );
      }
      return true;
    }
    case ChatEventType.CALL_PARTICIPANT_LEFT: {
      if (ce.payload.case === "callParticipant" && ce.payload.value.participant) {
        dispatch(
          participantLeft({
            callId: ce.payload.value.callId,
            identity: ce.payload.value.participant.identity,
          }),
        );
      }
      return true;
    }
    case ChatEventType.CALL_RING: {
      if (ce.payload.case === "callRing") {
        dispatch(ringReceived(ringPayloadToInvite(ce.payload.value, ce.channelId)));
      }
      return true;
    }
    case ChatEventType.CALL_HOST_CHANGED: {
      if (ce.payload.case === "callHostChanged") {
        dispatch(
          hostChanged({
            callId: ce.payload.value.callId,
            newHostUserId: ce.payload.value.newHostUserId,
          }),
        );
      }
      return true;
    }
    default:
      return false;
  }
}
