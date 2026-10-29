import type { CallRecord, CallAttendance } from "@uniffy/proto/calls/v1/calls_pb";
import { CallInvitationOutcome } from "@uniffy/proto/calls/v1/calls_pb";

export interface CallHistoryRecord {
  id: string;
  channelId: string;
  urn: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
  attended: boolean;
  outcome: string;
}
export interface CallActivityBucket {
  offsetSeconds: number;
  presentSeconds: number;
  observedSeconds: number;
  speakingSeconds: number;
}
export interface CallHistoryPerson {
  userId: string;
  name: string;
  joinedAt: string | null;
  outcome: string;
  activityResolutionSeconds: number;
  activityDurationSeconds: number;
  activity: CallActivityBucket[];
  speakingSeconds: number;
  observedSeconds: number;
  presentSeconds: number;
}
export function outcomeLabel(value: CallInvitationOutcome): string {
  switch (value) {
    case CallInvitationOutcome.MISSED:
      return "Missed";
    case CallInvitationOutcome.DECLINED:
      return "Declined";
    case CallInvitationOutcome.ANSWERED:
      return "Answered";
    case CallInvitationOutcome.RINGING:
      return "Ringing";
    default:
      return "";
  }
}
export function historyRecordToPlain(record: CallRecord): CallHistoryRecord {
  if (!record.call) throw new Error("Call record is missing");
  return {
    id: record.call.id,
    channelId: record.call.channelId,
    urn: record.urn,
    title: record.title,
    startedAt: new Date(Number(record.call.startedAt?.seconds ?? 0n) * 1000).toISOString(),
    endedAt: record.call.endedAt
      ? new Date(Number(record.call.endedAt.seconds) * 1000).toISOString()
      : null,
    participantCount: record.participantCount,
    attended: record.attended,
    outcome: outcomeLabel(record.invitationOutcome),
  };
}
export function historyPersonToPlain(person: CallAttendance): CallHistoryPerson {
  return {
    userId: person.userId,
    name: person.displayName,
    activityResolutionSeconds: person.activityResolutionSeconds,
    activityDurationSeconds: person.activityDurationSeconds,
    activity: person.activity.map(
      ({ offsetSeconds, presentSeconds, observedSeconds, speakingSeconds }) => ({
        offsetSeconds,
        presentSeconds,
        observedSeconds,
        speakingSeconds,
      }),
    ),
    speakingSeconds: person.speakingSeconds,
    observedSeconds: person.observedSeconds,
    presentSeconds: person.presentSeconds,
    outcome: outcomeLabel(person.invitationOutcome),
    joinedAt: person.joinedAt
      ? new Date(Number(person.joinedAt.seconds) * 1000).toISOString()
      : null,
  };
}
export function callDuration(record: CallHistoryRecord): string {
  if (!record.endedAt) return "Live";
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
