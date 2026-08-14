import { useMemo, useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import type { SerializedTeamNode } from "@/features/people/store/peopleThunks";

interface TeamPanelProps {
  teams: SerializedTeamNode[];
  selectedTeamId: string | null;
  onSelect: (teamId: string | null) => void;
}

interface TeamTreeEntry {
  team: SerializedTeamNode;
  children: TeamTreeEntry[];
}

function buildTeamTree(teams: SerializedTeamNode[]): TeamTreeEntry[] {
  const ids = new Set(teams.map((t) => t.groupId));
  const entries = new Map<string, TeamTreeEntry>(
    teams.map((team) => [team.groupId, { team, children: [] }]),
  );
  const roots: TeamTreeEntry[] = [];
  for (const entry of entries.values()) {
    const parentId = entry.team.parentGroupId;
    if (parentId && parentId !== entry.team.groupId && ids.has(parentId)) {
      entries.get(parentId)!.children.push(entry);
    } else {
      roots.push(entry);
    }
  }
  return roots;
}

function TeamRow({
  entry,
  depth,
  selectedTeamId,
  onSelect,
}: {
  entry: TeamTreeEntry;
  depth: number;
  selectedTeamId: string | null;
  onSelect: (teamId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedTeamId === entry.team.groupId;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md pr-2 transition-colors",
          isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/50",
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        {entry.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="p-1 text-muted-foreground hover:text-foreground"
            aria-label={expanded ? "Collapse team" : "Expand team"}
          >
            {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          </button>
        ) : (
          <span className="w-[22px]" />
        )}
        <button
          type="button"
          onClick={() => onSelect(isSelected ? null : entry.team.groupId)}
          className="flex min-w-0 flex-1 items-center py-1.5 text-left"
        >
          <span className={cn("truncate text-sm", isSelected ? "font-medium" : "text-foreground")}>
            {entry.team.name}
          </span>
        </button>
      </div>
      {expanded &&
        entry.children.map((child) => (
          <TeamRow
            key={child.team.groupId}
            entry={child}
            depth={depth + 1}
            selectedTeamId={selectedTeamId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function TeamPanel({ teams, selectedTeamId, onSelect }: TeamPanelProps) {
  const tree = useMemo(() => buildTeamTree(teams), [teams]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "mb-1 flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            selectedTeamId === null
              ? "bg-primary/10 font-medium text-primary"
              : "text-foreground hover:bg-muted/50",
          )}
        >
          Everyone
        </button>
        {tree.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No teams yet. An admin can create them under Administration &gt; Teams.
          </p>
        ) : (
          tree.map((entry) => (
            <TeamRow
              key={entry.team.groupId}
              entry={entry}
              depth={0}
              selectedTeamId={selectedTeamId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
