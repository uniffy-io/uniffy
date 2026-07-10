import {
  CallType as ProtoCallType,
  CallEndReason as ProtoCallEndReason,
} from '@uniffy/proto/calls/v1/calls_pb';
import type {
  Call as ProtoCall,
  CallParticipant as ProtoCallParticipant,
} from '@uniffy/proto/calls/v1/calls_pb';
import type { CallRingPayload } from '@uniffy/proto/chat/v1/chat_stream_pb';
import { timestampToIso } from '@/features/chat/api/chatConverters';
import type { CallData, CallParticipantData, CallType, CallEndReason, RingInvite } from '@/features/calls/types';

const CALL_TYPE_MAP: Record<number, CallType> = {
  [ProtoCallType.DIRECT]: 'DIRECT',
  [ProtoCallType.GROUP_DM]: 'GROUP_DM',
  [ProtoCallType.CHANNEL]: 'CHANNEL',
};

const END_REASON_MAP: Record<number, CallEndReason> = {
  [ProtoCallEndReason.HOST_ENDED]: 'HOST_ENDED',
  [ProtoCallEndReason.ALL_LEFT]: 'ALL_LEFT',
  [ProtoCallEndReason.MAX_DURATION]: 'MAX_DURATION',
  [ProtoCallEndReason.SOLO_TIMEOUT]: 'SOLO_TIMEOUT',
  [ProtoCallEndReason.CHANNEL_ARCHIVED]: 'CHANNEL_ARCHIVED',
};

export function participantToPlain(p: ProtoCallParticipant): CallParticipantData {
  return {
    userId: p.userId,
    deviceId: p.deviceId,
    identity: p.identity,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl ?? null,
    deviceLabel: p.deviceLabel ?? null,
    joinedAt: timestampToIso(p.joinedAt),
    micEnabled: p.micEnabled,
    cameraEnabled: p.cameraEnabled,
    screenSharing: p.screenSharing,
  };
}

export function callToPlain(call: ProtoCall): CallData {
  return {
    id: call.id,
    organizationId: call.organizationId,
    channelId: call.channelId,
    callType: CALL_TYPE_MAP[call.callType] ?? 'CHANNEL',
    initiatorUserId: call.initiatorUserId,
    hostUserId: call.hostUserId,
    startedAt: timestampToIso(call.startedAt),
    endedAt: timestampToIso(call.endedAt),
    endReason: call.endReason !== undefined ? END_REASON_MAP[call.endReason] ?? null : null,
    participants: call.participants.map(participantToPlain),
  };
}

export function ringPayloadToInvite(payload: CallRingPayload, channelId: string): RingInvite {
  return {
    callId: payload.callId,
    channelId,
    channelName: payload.channelName,
    callType: CALL_TYPE_MAP[payload.callType] ?? 'CHANNEL',
    callerUserId: payload.callerUserId,
    callerName: payload.callerName,
    callerAvatarUrl: payload.callerAvatarUrl ?? null,
    expiresAt: timestampToIso(payload.expiresAt),
  };
}
