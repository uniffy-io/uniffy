import type { ChannelType } from "@/features/chat/types";

export type MeetingMode = "none" | "link" | "channel";

export interface MeetingSubmit {
  /** Empty string clears the URL; a value binds a link meeting. */
  meetingUrl: string;
  /** undefined leaves the binding untouched; '' clears it; a uuid binds it. */
  channelId: string | undefined;
}

/**
 * Map the editor's meeting mode to the update payload. An event is either a
 * link meeting or a channel meeting, never both, so the unused side is always
 * cleared. channel_id is sent only when it changed, so an unrelated edit does
 * not thrash the binding.
 */
export function resolveMeetingSubmit(
  mode: MeetingMode,
  selectedChannelId: string | null,
  meetingUrl: string | undefined,
  prevChannelId: string | undefined,
): MeetingSubmit {
  const desiredChannelId = mode === "channel" ? selectedChannelId || "" : "";
  return {
    meetingUrl: mode === "link" ? meetingUrl || "" : "",
    channelId: desiredChannelId !== (prevChannelId || "") ? desiredChannelId : undefined,
  };
}

interface DiffMember {
  subjectType: "USER" | "AGENT";
  userId: string;
}

/**
 * Count attendees who cannot access a channel. Private channels gate on
 * membership, so the diff is against the member list; public channels are open
 * to the org and never surface a mismatch.
 */
export function countMissingAttendees(
  channelType: ChannelType,
  members: DiffMember[] | undefined,
  attendeeIds: string[],
): number {
  if (channelType === "PUBLIC" || !members) return 0;
  const memberIds = new Set(members.filter((m) => m.subjectType === "USER").map((m) => m.userId));
  return attendeeIds.filter((id) => !memberIds.has(id)).length;
}
