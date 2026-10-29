import type { CallData } from "@/features/calls/types";

export const AUDIENCE_MESSAGE = "Audience mode. Raise your hand to speak.";

export function canPublishInCall(call: CallData | null | undefined, userId: string): boolean {
  return !call?.townHall || call.hostUserId === userId || !!call.speakerUserIds?.includes(userId);
}

export function keepPublishingPolicy(previous: CallData, incoming: CallData): CallData {
  if ((previous.publishingRevision ?? 0) <= (incoming.publishingRevision ?? 0)) return incoming;
  return {
    ...incoming,
    townHall: previous.townHall,
    speakerUserIds: previous.speakerUserIds,
    publishingRevision: previous.publishingRevision,
    hostUserId: previous.hostUserId,
  };
}
