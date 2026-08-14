import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarById } from "@/components/subject";

/** Ceiling for the canvas zoom, and so for how far a node's avatar gets stretched. */
export const ORG_CHART_MAX_ZOOM = 2;

export interface OrgChartNodeData extends Record<string, unknown> {
  userId: string;
  displayName: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  descendantCount: number;
  hasReports: boolean;
  expanded: boolean;
  onToggleBranch: (userId: string, expanded: boolean) => void;
}

export type PersonFlowNode = Node<OrgChartNodeData, "person">;

export const OrgChartNode = memo(function OrgChartNode({ data }: NodeProps<PersonFlowNode>) {
  return (
    <div
      className={cn(
        "flex w-[220px] items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5",
        "shadow-sm transition-colors hover:border-primary/50",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-border"
      />
      <SubjectAvatarById
        userId={data.userId}
        displayName={data.displayName}
        avatarUrl={data.avatarUrl ?? undefined}
        size="md"
        maxScale={ORG_CHART_MAX_ZOOM}
        showPresence
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{data.displayName}</p>
        {data.jobTitle && <p className="truncate text-xs text-muted-foreground">{data.jobTitle}</p>}
      </div>
      {data.hasReports && (
        <button
          type="button"
          // The card itself navigates to the profile on click.
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleBranch(data.userId, !data.expanded);
          }}
          title={data.expanded ? "Collapse reports" : "Expand reports"}
          aria-label={
            data.expanded
              ? `Collapse the ${data.descendantCount} people under ${data.displayName}`
              : `Expand the ${data.descendantCount} people under ${data.displayName}`
          }
          aria-expanded={data.expanded}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-1 text-[10px] font-medium",
            "transition-colors",
            data.expanded
              ? "bg-muted text-muted-foreground hover:bg-muted/70"
              : "bg-primary/10 text-primary hover:bg-primary/20",
          )}
        >
          {data.expanded ? (
            <CaretDown size={10} weight="bold" />
          ) : (
            <CaretRight size={10} weight="bold" />
          )}
          {data.descendantCount}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-border"
      />
    </div>
  );
});
