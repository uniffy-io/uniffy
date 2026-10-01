import { useMemo } from "react";
import type { UrnMetadata } from "@uniffy/proto/search/v1/search_pb";
import { LiveIndicator } from "@/components/mention";
import { buildLiveStateFromMetadata } from "@/components/mention/buildLiveState";
import { stripMarkdown } from "@/features/search/utils/stripMarkdown";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { UrnType } from "@/shared/utils/urnTypes";
import type { GraphNode } from "@/features/library/utils/knowledgeGraphUtils";

interface GraphNodeDetailsProps {
  node: GraphNode;
  meta?: Omit<UrnMetadata, "$typeName">;
}

/** The mention-chip enrichment (status, dates, counts) for the graph hover card. */
export function GraphNodeDetails({ node, meta }: GraphNodeDetailsProps) {
  const liveState = useMemo(
    () => (meta ? buildLiveStateFromMetadata(node.urn, meta.title, meta.metadata ?? {}) : null),
    [node.urn, meta],
  );

  const rawDescription = meta?.description;
  const description = useMemo(
    () => (rawDescription ? stripMarkdown(rawDescription) : null),
    [rawDescription],
  );

  if (!liveState) return null;

  const facts: string[] = [];
  if (liveState.memberCount) {
    facts.push(`${liveState.memberCount} member${liveState.memberCount === 1 ? "" : "s"}`);
  }
  if (liveState.roomCapacity) facts.push(`Seats ${liveState.roomCapacity}`);
  const roomPlace = [liveState.roomBuilding, liveState.roomFloor && `floor ${liveState.roomFloor}`]
    .filter(Boolean)
    .join(", ");
  if (roomPlace) facts.push(roomPlace);
  if (liveState.eventLocation) facts.push(liveState.eventLocation);
  if (liveState.userJobTitle) facts.push(liveState.userJobTitle);
  if (liveState.userDepartment) facts.push(liveState.userDepartment);
  if (liveState.taskProjectName) facts.push(liveState.taskProjectName);

  const updated = liveState.updatedAt
    ? `Updated ${formatRelativeTime(liveState.updatedAt)}${
        liveState.updatedByName ? ` by ${liveState.updatedByName}` : ""
      }`
    : null;

  const showIndicator =
    (node.type === UrnType.TASK && !!liveState.taskStatus) ||
    (node.type === UrnType.CALENDAR_EVENT && !!liveState.eventStartTime) ||
    (node.type === UrnType.FILE && !!liveState.fileProcessingStatus) ||
    (node.type === UrnType.PROJECT && !!liveState.projectTotalTasks);

  if (!description && !showIndicator && facts.length === 0 && !updated) return null;

  return (
    <div className="mt-2.5 space-y-1.5">
      {description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {showIndicator && (
        <div className="flex flex-wrap items-center gap-1.5">
          <LiveIndicator urnType={node.type} liveState={liveState} />
        </div>
      )}
      {facts.length > 0 && (
        <p className="truncate text-[11px] text-muted-foreground">{facts.join(" · ")}</p>
      )}
      {updated && <p className="text-[10px] text-muted-foreground/70">{updated}</p>}
    </div>
  );
}
