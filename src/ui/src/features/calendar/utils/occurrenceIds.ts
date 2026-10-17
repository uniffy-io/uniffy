export const OCCURRENCE_ID_SEPARATOR = "__occurrence__";

/**
 * Expanded occurrences carry `<masterId>__occurrence__<date>` as their id. Cross-domain RPCs
 * (attachments, sharing) parse the id as a UUID, so they need the series row instead.
 */
export function masterEventId(eventId: string): string {
  const index = eventId.indexOf(OCCURRENCE_ID_SEPARATOR);
  return index === -1 ? eventId : eventId.slice(0, index);
}
