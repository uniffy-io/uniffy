/**
 * EdgeStyleToolbar - Floating toolbar for edge style customization.
 *
 * Appears at click coordinates when an edge is selected. Provides
 * shape, color, and width pickers. Closes on click-outside or Escape.
 */

import { memo, useEffect, useRef, useState } from "react";
import { BezierCurve, LineSegment, Path, ArrowBendRightDown } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { popoverShellClass } from "@/components/ui/popover";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { cn } from "@/shared/utils/cn";
import { NODE_COLORS, BORDER_WIDTHS } from "@/features/notes/canvas/components/nodeStyleConstants";
import type { EdgeShape, CanvasEdgeData } from "@/features/notes/canvas/types";

interface EdgeStyleToolbarProps {
  x: number;
  y: number;
  edgeData?: CanvasEdgeData;
  onStyleChange: (updates: Partial<CanvasEdgeData>) => void;
  onClose: () => void;
}

const EDGE_SHAPES: { value: EdgeShape; label: string; icon: Icon }[] = [
  { value: "default", label: "Bezier", icon: BezierCurve },
  { value: "straight", label: "Straight", icon: LineSegment },
  { value: "smoothstep", label: "Smooth Step", icon: Path },
  { value: "step", label: "Step", icon: ArrowBendRightDown },
];

export const EdgeStyleToolbar = memo(function EdgeStyleToolbar({
  x,
  y,
  edgeData,
  onStyleChange,
  onClose,
}: EdgeStyleToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<"color" | "width" | false>(false);

  const currentShape = edgeData?.edgeShape ?? "default";
  const currentColor = edgeData?.strokeColor ?? "";
  const currentWidth = edgeData?.strokeWidth;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useOverlayEscape(onClose);

  return (
    <div
      ref={toolbarRef}
      className={cn(popoverShellClass, "fixed z-50 p-2 min-w-[200px]")}
      style={{ left: x, top: y }}
    >
      {/* Shape picker */}
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
        Shape
      </div>
      <div className="flex gap-1 mb-2">
        {EDGE_SHAPES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => onStyleChange({ edgeShape: value })}
            className={cn(
              "p-1.5 rounded border transition-colors",
              value === currentShape
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-foreground hover:bg-muted",
            )}
            title={label}
          >
            <Icon size={16} weight="duotone" />
          </button>
        ))}
      </div>

      <div className="h-px bg-border my-1.5" />

      {/* Color */}
      <button
        onClick={() => setActivePanel(activePanel === "color" ? false : "color")}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
      >
        <span
          className="w-4 h-4 rounded border border-border shrink-0"
          style={{
            backgroundColor:
              currentColor && currentColor !== "transparent" ? currentColor : undefined,
          }}
        >
          {(!currentColor || currentColor === "transparent") && (
            <span className="flex items-center justify-center h-full text-[7px] text-muted-foreground">
              /
            </span>
          )}
        </span>
        <span>Color</span>
      </button>

      {activePanel === "color" && (
        <div className="mt-1 px-1 flex flex-wrap gap-1">
          {NODE_COLORS.map((c) => (
            <button
              key={`ec-${c}`}
              onClick={() => {
                onStyleChange({ strokeColor: c });
                setActivePanel(false);
              }}
              className={cn(
                "w-5 h-5 rounded border transition-transform",
                c === currentColor ? "border-foreground scale-110" : "border-border",
              )}
              style={{ backgroundColor: c === "transparent" ? undefined : c }}
              title={c === "transparent" ? "Default" : c}
            >
              {c === "transparent" && (
                <span className="flex items-center justify-center text-[8px] text-muted-foreground">
                  /
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Width */}
      <button
        onClick={() => setActivePanel(activePanel === "width" ? false : "width")}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
      >
        <span className="w-4 h-4 rounded border border-border flex items-center justify-center text-[9px] text-foreground shrink-0">
          {currentWidth ?? "-"}
        </span>
        <span>Width</span>
      </button>

      {activePanel === "width" && (
        <div className="mt-1 px-1 flex gap-1">
          {BORDER_WIDTHS.map((w) => (
            <button
              key={`ew-${w}`}
              onClick={() => {
                onStyleChange({ strokeWidth: w || undefined });
                setActivePanel(false);
              }}
              className={cn(
                "w-6 h-6 rounded border flex items-center justify-center text-xs transition-colors",
                w === currentWidth
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-foreground hover:bg-muted",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
