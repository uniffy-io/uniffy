/** Ungrouped boards are one lane with this key, so every card and drop zone carries a lane. */
export const SINGLE_LANE_KEY = "";

const DROP_PREFIX = "lane-drop|";
const CARD_PREFIX = "lane-card|";
const SEP = "|";

/** Keys are encoded so a separator inside one can never split the id in the wrong place. */
export function buildLaneDropId(laneKey: string, columnKey: string): string {
  return `${DROP_PREFIX}${encodeURIComponent(laneKey)}${SEP}${encodeURIComponent(columnKey)}`;
}

export function parseLaneDropId(id: string): { laneKey: string; columnKey: string } | null {
  if (!id.startsWith(DROP_PREFIX)) return null;
  const [lane, column] = id.slice(DROP_PREFIX.length).split(SEP);
  if (lane === undefined || column === undefined) return null;
  return { laneKey: decodeURIComponent(lane), columnKey: decodeURIComponent(column) };
}

/** A task can sit in several lanes at once; its card id names the lane it was drawn in. */
export function buildLaneCardId(laneKey: string, taskId: string): string {
  return `${CARD_PREFIX}${encodeURIComponent(laneKey)}${SEP}${taskId}`;
}

export function parseLaneCardId(id: string): { laneKey: string; taskId: string } | null {
  if (!id.startsWith(CARD_PREFIX)) return null;
  const [lane, taskId] = id.slice(CARD_PREFIX.length).split(SEP);
  if (lane === undefined || !taskId) return null;
  return { laneKey: decodeURIComponent(lane), taskId };
}
