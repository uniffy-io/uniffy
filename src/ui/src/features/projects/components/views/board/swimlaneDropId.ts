export const NO_EPIC_LANE_ID = "__no_epic__";
const SWIMLANE_DROP_PREFIX = "swimlane::";
const LANE_STATUS_SEP = "::";

export function buildSwimlaneDropId(laneId: string, statusId: string): string {
  return `${SWIMLANE_DROP_PREFIX}${laneId}${LANE_STATUS_SEP}${statusId}`;
}

export function parseSwimlaneDropId(id: string): { laneId: string; statusId: string } | null {
  if (!id.startsWith(SWIMLANE_DROP_PREFIX)) return null;
  const rest = id.slice(SWIMLANE_DROP_PREFIX.length);
  const sep = rest.indexOf(LANE_STATUS_SEP);
  if (sep === -1) return null;
  return { laneId: rest.slice(0, sep), statusId: rest.slice(sep + LANE_STATUS_SEP.length) };
}
