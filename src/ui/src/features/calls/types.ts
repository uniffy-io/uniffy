export type CallType = 'DIRECT' | 'GROUP_DM' | 'CHANNEL';

export type CallEndReason =
  | 'HOST_ENDED'
  | 'ALL_LEFT'
  | 'MAX_DURATION'
  | 'SOLO_TIMEOUT'
  | 'CHANNEL_ARCHIVED';

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
}

export interface CallData {
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
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface CallEndedInfo {
  callId: string;
  channelId: string;
  reason: CallEndReason | null;
}
