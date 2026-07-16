import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  CallType as ProtoCallType,
  CallEndReason as ProtoCallEndReason,
} from "@uniffy/proto/calls/v1/calls_pb";
import type {
  Call as ProtoCall,
  CallParticipant as ProtoCallParticipant,
} from "@uniffy/proto/calls/v1/calls_pb";
import type { CallRingPayload } from "@uniffy/proto/chat/v1/chat_stream_pb";

export type CallKind = "DIRECT" | "GROUP_DM" | "CHANNEL";
export type CallEndReason =
  "HOST_ENDED" | "ALL_LEFT" | "MAX_DURATION" | "SOLO_TIMEOUT" | "CHANNEL_ARCHIVED" | "UNKNOWN";

export interface PlainParticipant {
  userId: string;
  deviceId: string;
  identity: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAtSeconds: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
}

export interface PlainCall {
  id: string;
  channelId: string;
  callType: CallKind;
  initiatorUserId: string;
  hostUserId: string;
  startedAtSeconds: number;
  participants: PlainParticipant[];
}

export interface RingInvite {
  callId: string;
  channelId: string;
  channelName: string;
  callType: CallKind;
  callerUserId: string;
  callerName: string;
  callerAvatarUrl: string | null;
  expiresAtSeconds: number;
}

const CALL_TYPE_MAP: Record<number, CallKind> = {
  [ProtoCallType.DIRECT]: "DIRECT",
  [ProtoCallType.GROUP_DM]: "GROUP_DM",
  [ProtoCallType.CHANNEL]: "CHANNEL",
};

const END_REASON_MAP: Record<number, CallEndReason> = {
  [ProtoCallEndReason.HOST_ENDED]: "HOST_ENDED",
  [ProtoCallEndReason.ALL_LEFT]: "ALL_LEFT",
  [ProtoCallEndReason.MAX_DURATION]: "MAX_DURATION",
  [ProtoCallEndReason.SOLO_TIMEOUT]: "SOLO_TIMEOUT",
  [ProtoCallEndReason.CHANNEL_ARCHIVED]: "CHANNEL_ARCHIVED",
};

function tsToSeconds(ts: Timestamp | undefined): number {
  if (!ts) return 0;
  return typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds;
}

export function endReasonToPlain(reason: ProtoCallEndReason | undefined): CallEndReason {
  if (reason === undefined) return "UNKNOWN";
  return END_REASON_MAP[reason] ?? "UNKNOWN";
}

export function participantToPlain(proto: ProtoCallParticipant): PlainParticipant {
  return {
    userId: proto.userId,
    deviceId: proto.deviceId,
    identity: proto.identity,
    displayName: proto.displayName,
    avatarUrl: proto.avatarUrl ?? null,
    joinedAtSeconds: tsToSeconds(proto.joinedAt),
    micEnabled: proto.micEnabled,
    cameraEnabled: proto.cameraEnabled,
    screenSharing: proto.screenSharing,
  };
}

export function callToPlain(proto: ProtoCall): PlainCall {
  return {
    id: proto.id,
    channelId: proto.channelId,
    callType: CALL_TYPE_MAP[proto.callType] ?? "CHANNEL",
    initiatorUserId: proto.initiatorUserId,
    hostUserId: proto.hostUserId,
    startedAtSeconds: tsToSeconds(proto.startedAt),
    participants: proto.participants.map(participantToPlain),
  };
}

export function identityUserId(identity: string): string {
  const separator = identity.indexOf(":");
  return separator === -1 ? identity : identity.slice(0, separator);
}

export function formatCallDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

export function ringToInvite(payload: CallRingPayload, channelId: string): RingInvite {
  return {
    callId: payload.callId,
    channelId,
    channelName: payload.channelName,
    callType: CALL_TYPE_MAP[payload.callType] ?? "CHANNEL",
    callerUserId: payload.callerUserId,
    callerName: payload.callerName,
    callerAvatarUrl: payload.callerAvatarUrl ?? null,
    expiresAtSeconds: tsToSeconds(payload.expiresAt),
  };
}
