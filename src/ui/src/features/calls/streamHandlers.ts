import { ChatEventType } from "@uniffy/proto/chat/v1/chat_stream_pb";
import type { ChatEvent } from "@uniffy/proto/chat/v1/chat_stream_pb";
import {
  callToPlain,
  participantToPlain,
  ringPayloadToInvite,
} from "@/features/calls/api/callsConverters";
import {
  callUpserted,
  reactionReceived,
  feedbackChanged,
  callEnded,
  participantUpserted,
  participantLeft,
  hostChanged,
  ringReceived,
} from "@/features/calls/store/callsSlice";
import { getDeviceId } from "@/shared/utils/deviceId";
import { MODERATOR_MUTED_COPY } from "@/features/calls/utils/callErrors";
import type { AppDispatch } from "@/app/store";

/**
 * Call events apply globally (channel indicators, ringing, the session the
 * user is in), never filtered to the active channel. Returns true when the
 * event was a call event and is fully handled.
 */
export function handleCallStreamEvent(ce: ChatEvent, dispatch: AppDispatch): boolean {
  switch (ce.eventType) {
    case ChatEventType.CALL_REACTION: {
      if (ce.payload.case === "callReaction" && ce.payload.value.expiresAt) {
        const r = ce.payload.value;
        const expiresAt = Number(r.expiresAt!.seconds) * 1000 + r.expiresAt!.nanos / 1e6;
        if (expiresAt > Date.now()) dispatch(reactionReceived({ ...r, expiresAt }));
      }
      return true;
    }
    case ChatEventType.CALL_STARTED: {
      if (ce.payload.case === "callLifecycle" && ce.payload.value.call) {
        dispatch(callUpserted(callToPlain(ce.payload.value.call)));
      }
      return true;
    }
    case ChatEventType.CALL_ENDED: {
      if (ce.payload.case === "callLifecycle" && ce.payload.value.call) {
        const call = callToPlain(ce.payload.value.call);
        dispatch(
          callEnded({
            callId: call.id,
            channelId: call.channelId,
            reason: call.endReason,
          }),
        );
      }
      return true;
    }
    case ChatEventType.CALL_PARTICIPANT_JOINED:
    case ChatEventType.CALL_PARTICIPANT_STATE: {
      if (ce.payload.case === "callParticipant" && ce.payload.value.participant) {
        const payload = ce.payload.value;
        if (payload.moderatorMuted) {
          dispatch((innerDispatch, getState) => {
            const state = getState();
            if (
              state.calls.session.callId === payload.callId &&
              payload.participant?.identity === `${state.auth.user?.id}:${getDeviceId()}`
            ) {
              innerDispatch(feedbackChanged(MODERATOR_MUTED_COPY));
            }
          });
        }
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
