import type { PlainCall } from "@features/calls/callsSerializer";

export const AUDIENCE_MESSAGE = "Audience mode. Raise your hand to speak.";

export function canPublishInCall(call: PlainCall | undefined, userId: string): boolean {
  return !call?.townHall || call.hostUserId === userId || !!call.speakerUserIds?.includes(userId);
}
