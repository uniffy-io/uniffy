import type { ReactNode } from "react";
import { LAYOUT } from "@/features/projects/constants";

const CORNER_RADIUS = 6;
const STUB_LENGTH = 16; // horizontal stub out of bar before turning

interface DependencyLinesProps {
  tasks: Array<{
    id: string;
    key: string;
    groupKey: string | null;
    blockedByTaskIds: string[];
    row: number;
    left: number;
    width: number;
  }>;
}

/** Right-stub then vertical then horizontal with rounded corners. */
function buildOrthogonalPath(sx: number, sy: number, ex: number, ey: number): string {
  // Same row - just a straight horizontal line
  if (sy === ey) {
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }

  const goingDown = ey > sy;

  // If the end is far enough right, route: right stub, down/up, right to end
  if (ex - sx > STUB_LENGTH * 2) {
    const turnX = sx + STUB_LENGTH;
    const verticalDist = Math.abs(ey - sy);
    const r = Math.min(CORNER_RADIUS, STUB_LENGTH, verticalDist / 2);
    const ry = goingDown ? r : -r;

    return [
      `M ${sx} ${sy}`,
      `L ${turnX - r} ${sy}`,
      `Q ${turnX} ${sy}, ${turnX} ${sy + ry}`,
      `L ${turnX} ${ey - ry}`,
      `Q ${turnX} ${ey}, ${turnX + r} ${ey}`,
      `L ${ex} ${ey}`,
    ].join(" ");
  }

  // 3-segment route for when end is close or behind start:
  // right stub -> vertical to midY -> horizontal to enterX -> vertical to endY -> right to end
  const stubEndX = sx + STUB_LENGTH;
  const midY = (sy + ey) / 2;
  const enterX = ex - STUB_LENGTH;
  const goingLeft = enterX < stubEndX;

  // Clamp radius so it fits within the shortest segment
  const halfVertical = Math.abs(midY - sy);
  const horizontalDist = Math.abs(enterX - stubEndX);
  const r = Math.min(
    CORNER_RADIUS,
    halfVertical / 2,
    horizontalDist > 0 ? horizontalDist / 2 : CORNER_RADIUS,
  );

  const ry = goingDown ? r : -r;
  const hx = goingLeft ? -r : r;

  return [
    `M ${sx} ${sy}`,
    `L ${stubEndX - r} ${sy}`,
    `Q ${stubEndX} ${sy}, ${stubEndX} ${sy + ry}`,
    `L ${stubEndX} ${midY - ry}`,
    `Q ${stubEndX} ${midY}, ${stubEndX + hx} ${midY}`,
    `L ${enterX - hx} ${midY}`,
    `Q ${enterX} ${midY}, ${enterX} ${midY + ry}`,
    `L ${enterX} ${ey - ry}`,
    `Q ${enterX} ${ey}, ${enterX + r} ${ey}`,
    `L ${ex} ${ey}`,
  ].join(" ");
}

export function DependencyLines({ tasks }: DependencyLinesProps) {
  const occurrences = new Map<string, DependencyLinesProps["tasks"]>();
  for (const task of tasks) {
    const rows = occurrences.get(task.id) ?? [];
    rows.push(task);
    occurrences.set(task.id, rows);
  }
  const lines: ReactNode[] = [];

  tasks.forEach((task) => {
    if (!task.blockedByTaskIds || task.blockedByTaskIds.length === 0) return;

    task.blockedByTaskIds.forEach((blockerId) => {
      const candidates = occurrences.get(blockerId);
      const blocker = candidates?.find((row) => row.groupKey === task.groupKey) ?? candidates?.[0];
      if (!blocker) return;

      const sx = blocker.left + blocker.width;
      const sy = blocker.row * LAYOUT.ROADMAP_ROW_HEIGHT + LAYOUT.ROADMAP_ROW_HEIGHT / 2;
      const ex = task.left;
      const ey = task.row * LAYOUT.ROADMAP_ROW_HEIGHT + LAYOUT.ROADMAP_ROW_HEIGHT / 2;

      const d = buildOrthogonalPath(sx, sy, ex, ey);

      lines.push(
        <g key={JSON.stringify([blocker.key, task.key])}>
          <path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            opacity="0.8"
            markerEnd="url(#dep-arrow)"
          />
        </g>,
      );
    });
  });

  if (lines.length === 0) return null;

  return (
    <svg
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-0 text-muted-foreground"
      style={{ minHeight: (tasks.at(-1)!.row + 1) * LAYOUT.ROADMAP_ROW_HEIGHT }}
    >
      <defs>
        <marker id="dep-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="currentColor" opacity="0.8" />
        </marker>
      </defs>
      {lines}
    </svg>
  );
}
