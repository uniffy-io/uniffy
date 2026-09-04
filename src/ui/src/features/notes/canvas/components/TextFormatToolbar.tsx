/**
 * TextFormatToolbar - Floating toolbar for text formatting on canvas text nodes.
 *
 * Controls: Bold, Italic, Underline, Font Size, Fill color, Border color, Border width.
 * Positioned above the selected text node.
 */

import { useState } from "react";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { NODE_COLORS, BORDER_WIDTHS } from "@/features/notes/canvas/components/nodeStyleConstants";

const FONT_SIZES = [12, 14, 16, 20, 24, 32, 48, 64];

type Panel = "sizes" | "fill" | "border" | "width" | false;

type TextAlign = "left" | "center" | "right";

interface TextFormatToolbarProps {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  textAlign: TextAlign;
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  onStyleChange: (updates: Record<string, unknown>) => void;
}

export function TextFormatToolbar({
  bold,
  italic,
  underline,
  fontSize,
  textAlign,
  fillColor,
  borderColor,
  borderWidth,
  onStyleChange,
}: TextFormatToolbarProps) {
  const [activePanel, setActivePanel] = useState<Panel>(false);

  const togglePanel = (panel: Panel) => {
    setActivePanel(activePanel === panel ? false : panel);
  };

  return (
    <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 nopan nodrag">
      <div className={cn(popoverShellClass, "flex items-center gap-0.5 px-1.5 py-1")}>
        {/* Bold */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onStyleChange({ bold: !bold });
          }}
          className={cn(
            "w-7 h-7 rounded flex items-center justify-center text-sm font-bold transition-colors",
            bold ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
          )}
          title="Bold"
        >
          B
        </button>

        {/* Italic */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onStyleChange({ italic: !italic });
          }}
          className={cn(
            "w-7 h-7 rounded flex items-center justify-center text-sm italic transition-colors",
            italic ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
          )}
          title="Italic"
        >
          I
        </button>

        {/* Underline */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onStyleChange({ underline: !underline });
          }}
          className={cn(
            "w-7 h-7 rounded flex items-center justify-center text-sm underline transition-colors",
            underline ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
          )}
          title="Underline"
        >
          U
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Font size */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            togglePanel("sizes");
          }}
          className="h-7 px-1.5 rounded flex items-center justify-center text-xs text-foreground hover:bg-muted transition-colors tabular-nums"
          title="Font size"
        >
          {fontSize}
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Align left */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onStyleChange({ textAlign: "left" });
          }}
          className={cn(
            "w-7 h-7 rounded flex items-center justify-center transition-colors",
            textAlign === "left" ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
          )}
          title="Align left"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="2" y1="3" x2="14" y2="3" />
            <line x1="2" y1="7" x2="10" y2="7" />
            <line x1="2" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        {/* Align center */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onStyleChange({ textAlign: "center" });
          }}
          className={cn(
            "w-7 h-7 rounded flex items-center justify-center transition-colors",
            textAlign === "center"
              ? "bg-primary/15 text-primary"
              : "text-foreground hover:bg-muted",
          )}
          title="Align center"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="2" y1="3" x2="14" y2="3" />
            <line x1="4" y1="7" x2="12" y2="7" />
            <line x1="2" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        {/* Align right */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onStyleChange({ textAlign: "right" });
          }}
          className={cn(
            "w-7 h-7 rounded flex items-center justify-center transition-colors",
            textAlign === "right" ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
          )}
          title="Align right"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="2" y1="3" x2="14" y2="3" />
            <line x1="6" y1="7" x2="14" y2="7" />
            <line x1="2" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Fill color */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            togglePanel("fill");
          }}
          className="relative w-5 h-5 rounded border border-border"
          style={{ backgroundColor: fillColor === "transparent" ? undefined : fillColor }}
          title="Background"
        >
          {fillColor === "transparent" && (
            <span className="absolute inset-0 flex items-center justify-center text-[8px] text-muted-foreground leading-none">
              /
            </span>
          )}
        </button>

        {/* Border color */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            togglePanel("border");
          }}
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
          onMouseDown={(e) => {
            e.preventDefault();
            togglePanel("width");
          }}
          className="flex items-center justify-center w-5 h-5 rounded border border-border text-[9px] text-foreground"
          title="Border width"
        >
          {borderWidth}
        </button>
      </div>

      {/* Font size picker */}
      {activePanel === "sizes" && (
        <div
          className={cn(
            popoverShellClass,
            "absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-0.5 p-1.5",
          )}
        >
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                onStyleChange({ fontSize: s });
                setActivePanel(false);
              }}
              className={cn(
                "w-8 h-7 rounded flex items-center justify-center text-xs transition-colors",
                s === fontSize ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Fill color picker */}
      {activePanel === "fill" && (
        <div
          className={cn(
            popoverShellClass,
            "absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-1 p-1.5",
          )}
        >
          {NODE_COLORS.map((c) => (
            <button
              key={`fill-${c}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onStyleChange({ bgColor: c });
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
        <div
          className={cn(
            popoverShellClass,
            "absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-1 p-1.5",
          )}
        >
          {NODE_COLORS.map((c) => (
            <button
              key={`border-${c}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onStyleChange({ borderColor: c });
                setActivePanel(false);
              }}
              className={cn(
                "w-5 h-5 rounded border transition-transform",
                c === borderColor ? "border-foreground scale-110" : "border-border",
              )}
              style={{ backgroundColor: c === "transparent" ? undefined : c }}
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
        <div
          className={cn(
            popoverShellClass,
            "absolute top-full left-1/2 -translate-x-1/2 mt-1 flex gap-1 p-1.5",
          )}
        >
          {BORDER_WIDTHS.map((w) => (
            <button
              key={`width-${w}`}
              onMouseDown={(e) => {
                e.preventDefault();
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
