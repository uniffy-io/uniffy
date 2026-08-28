export interface MeetingCandidate {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  cancelled: boolean;
}

/**
 * The meeting a channel should advertise: the one running now if there is one,
 * otherwise the soonest still to come. Cancelled events never qualify.
 *
 * Compares epochs rather than ISO strings - the range RPC returns expanded
 * occurrences whose millisecond precision varies, and mixed-precision ISO
 * strings do not order lexicographically.
 */
export function pickNextMeeting(
  candidates: readonly MeetingCandidate[],
  now: Date,
): MeetingCandidate | null {
  const nowMs = now.getTime();
  const live = candidates
    .filter((c) => !c.cancelled)
    .filter((c) => Date.parse(c.startTime) <= nowMs && Date.parse(c.endTime) > nowMs)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (live.length > 0) return live[0];

  const upcoming = candidates
    .filter((c) => !c.cancelled)
    .filter((c) => Date.parse(c.startTime) > nowMs)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  return upcoming[0] ?? null;
}

/** Forward-looking countdown for the strip: "in 3 min", "in 2 h", "now". */
export function formatCountdown(startTime: string, now: Date): string {
  const diffMs = Date.parse(startTime) - now.getTime();
  if (diffMs <= 0) return "now";

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "in less than a minute";
  if (minutes < 60) return `in ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `in ${hours} h ${remainder} min` : `in ${hours} h`;

  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
