/**
 * CustomEdge - Custom edge component supporting multiple shapes and styles.
 *
 * Reads edgeShape, strokeColor, and strokeWidth from edge data to render
 * bezier, straight, step, or smooth-step paths with custom styling.
 */

import {
  BaseEdge,
  getBezierPath,
  getStraightPath,
  getSmoothStepPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";
import type { CanvasEdge, CanvasEdgeData } from "@/features/notes/canvas/types";

const DEFAULT_STROKE_COLOR = "hsl(var(--muted-foreground) / 0.4)";
const DEFAULT_STROKE_WIDTH = 1.5;

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<CanvasEdge>) {
  const edgeData = data as CanvasEdgeData | undefined;
  const shape = edgeData?.edgeShape ?? "default";
  const strokeColor = edgeData?.strokeColor ?? DEFAULT_STROKE_COLOR;
  const strokeWidth = edgeData?.strokeWidth ?? DEFAULT_STROKE_WIDTH;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  const pathParams = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };

  switch (shape) {
    case "straight": {
      const [path, lx, ly] = getStraightPath(pathParams);
      edgePath = path;
      labelX = lx;
      labelY = ly;
      break;
    }
    case "step": {
      const [path, lx, ly] = getSmoothStepPath({ ...pathParams, borderRadius: 0 });
      edgePath = path;
      labelX = lx;
      labelY = ly;
      break;
    }
    case "smoothstep": {
      const [path, lx, ly] = getSmoothStepPath(pathParams);
      edgePath = path;
      labelX = lx;
      labelY = ly;
      break;
    }
    default: {
      const [path, lx, ly] = getBezierPath(pathParams);
      edgePath = path;
      labelX = lx;
      labelY = ly;
      break;
    }
  }

  return (
    <>
      {/* Invisible wider hit area for easier selection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(strokeWidth + 14, 20)}
        className="react-flow__edge-interaction"
      />
      <BaseEdge
        id={id as string}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          opacity: selected ? 1 : undefined,
        }}
      />
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="text-xs bg-card px-2 py-0.5 rounded border border-border shadow-sm text-foreground"
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
