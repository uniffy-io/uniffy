/**
 * NodeStyleToolbar - Shared style toolbar for all canvas node types.
 *
 * Renders fill/bg color, border color, and border width pickers
 * in a floating toolbar above the selected node.
 */

import { useState } from "react";
import { cn } from "@/shared/utils/cn";
import { NODE_COLORS, BORDER_WIDTHS } from "@/features/notes/canvas/components/nodeStyleConstants";

interface NodeStyleToolbarProps {
  /** Current fill/background color */
  fillColor: string;
  /** Current border color */
  borderColor: string;
  /** Current border width */
  borderWidth: number;
  /** Callback when any style property changes */
  onStyleChange: (updates: Record<string, unknown>) => void;
  /** Field name emitted for fill changes (e.g. "color" for shapes, "bgColor" for cards) */
  fillFieldName?: string;
  /** Label for the fill button tooltip */
  fillLabel?: string;
}

export function NodeStyleToolbar({
  fillColor,
  borderColor,
  borderWidth,
  onStyleChange,
  fillFieldName = "bgColor",
  fillLabel = "Background",
}: NodeStyleToolbarProps) {
  const [activePanel, setActivePanel] = useState<"fill" | "border" | "width" | false>(false);

  return (
    <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 nopan nodrag">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-card border border-border rounded-lg shadow-lg">
        {/* Fill/background color */}
        <button
          onClick={() => setActivePanel(activePanel === "fill" ? false : "fill")}
          className="relative w-5 h-5 rounded border border-border"
          style={{ backgroundColor: fillColor === "transparent" ? undefined : fillColor }}
          title={fillLabel}
        >
          {fillColor === "transparent" && (
            <span className="absolute inset-0 flex items-center justify-center text-[8px] text-muted-foreground leading-none">
              /
            </span>
          )}
        </button>

        {/* Border color */}
        <button
          onClick={() => setActivePanel(activePanel === "border" ? false : "border")}
          className="relative w-5 h-5 rounded"
          style={{
            border:
              borderColor === "transparent"
                ? "2px dashed hsl(var(--muted-foreground) / 0.4)"
                : `2px solid ${borderColor}`,
          }}
          title="Border color"
        />

        {/* Border width */}
        <button
          onClick={() => setActivePanel(activePanel === "width" ? false : "width")}
          className="flex items-center justify-center w-5 h-5 rounded border border-border text-[9px] text-foreground"
          title="Border width"
        >
          {borderWidth}
        </button>
      </div>

      {/* Fill/background color picker */}
      {activePanel === "fill" && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-1 p-1.5 bg-card border border-border rounded-lg shadow-lg">
          {NODE_COLORS.map((c) => (
            <button
              key={`fill-${c}`}
              onClick={() => {
                onStyleChange({ [fillFieldName]: c });
                setActivePanel(false);
              }}
              className={cn(
                "w-5 h-5 rounded border transition-transform",
                c === fillColor ? "border-foreground scale-110" : "border-border",
              )}
              style={{ backgroundColor: c === "transparent" ? undefined : c }}
              title={c === "transparent" ? "No fill" : c}
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

      {/* Border color picker */}
      {activePanel === "border" && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-1 p-1.5 bg-card border border-border rounded-lg shadow-lg">
          {NODE_COLORS.map((c) => (
            <button
              key={`border-${c}`}
              onClick={() => {
                onStyleChange({ borderColor: c });
                setActivePanel(false);
              }}
              className={cn(
                "w-5 h-5 rounded border transition-transform",
                c === borderColor ? "border-foreground scale-110" : "border-border",
              )}
              style={{
                backgroundColor: c === "transparent" ? undefined : c,
              }}
              title={c === "transparent" ? "No border" : c}
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

      {/* Border width picker */}
      {activePanel === "width" && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-1 p-1.5 bg-card border border-border rounded-lg shadow-lg">
          {BORDER_WIDTHS.map((w) => (
            <button
              key={`width-${w}`}
              onClick={() => {
                onStyleChange({ borderWidth: w });
                setActivePanel(false);
              }}
              className={cn(
                "w-6 h-6 rounded border flex items-center justify-center text-xs transition-colors",
                w === borderWidth
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
}
