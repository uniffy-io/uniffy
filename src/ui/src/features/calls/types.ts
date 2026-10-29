export type CallType = "DIRECT" | "GROUP_DM" | "CHANNEL";

export type CallEndReason =
  | "HOST_ENDED"
  | "ALL_LEFT"
  | "MAX_DURATION"
  | "SOLO_TIMEOUT"
  | "CHANNEL_ARCHIVED"
  | "ORG_SUSPENDED"
  | "ORG_DELETED";

export interface CallParticipantData {
  userId: string;
  deviceId: string;
  identity: string;
  displayName: string;
  avatarUrl: string | null;
  deviceLabel: string | null;
  joinedAt: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  handRaisedAt?: string | null;
  handRevision?: number;
}

export interface CallData {
  townHall?: boolean;
  speakerUserIds?: string[];
  publishingRevision?: number;
  id: string;
  organizationId: string;
  channelId: string;
  callType: CallType;
  initiatorUserId: string;
  hostUserId: string;
  startedAt: string | null;
  endedAt: string | null;
  endReason: CallEndReason | null;
  participants: CallParticipantData[];
}

export interface IceServerData {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface RingInvite {
  callId: string;
  channelId: string;
  channelName: string;
  callType: CallType;
  callerUserId: string;
  callerName: string;
  callerAvatarUrl: string | null;
  expiresAt: string | null;
}

export type CallSessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface CallEndedInfo {
  callId: string;
  channelId: string;
  reason: CallEndReason | "KICKED" | "DISPLACED" | null;
}

export interface CallReactionData {
  id: string;
  callId: string;
  userId: string;
  displayName: string;
  reaction: import("@uniffy/proto/calls/v1/calls_pb").CallReaction;
  expiresAt: number;
}
