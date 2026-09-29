import {
  getMentionUrl,
  invalidateMentionState,
  onMentionStateChange,
} from "@/components/mention/mentionStateEmitter";
import { getResolvedUrl, resolveUrnBatched } from "@/components/mention/useBatchedSubjectResolver";

const OCCURRENCE_URN =
  /^(urn:uniffy:content:CALENDAR_EVENT:[0-9a-f-]{36})__occurrence__\d{4}-\d{2}-\d{2}$/;

/** Series patches need recurrence expansion before their times can reach occurrence cards. */
export function watchCalendarOccurrence(urn: string, organizationId: string): () => void {
  const masterUrn = OCCURRENCE_URN.exec(urn)?.[1];
  if (!masterUrn) return () => {};

  return onMentionStateChange((changedUrn) => {
    const url = getMentionUrl(urn) || getResolvedUrl(urn);
    const targetId = url ? new URLSearchParams(url.split("?")[1]).get("event") : null;
    const targetUrn = targetId ? `urn:uniffy:content:CALENDAR_EVENT:${targetId}` : null;
    if (changedUrn === urn || (changedUrn !== masterUrn && changedUrn !== targetUrn)) return;

    invalidateMentionState(urn);
    void resolveUrnBatched(urn, organizationId, { force: true });
  });
}
