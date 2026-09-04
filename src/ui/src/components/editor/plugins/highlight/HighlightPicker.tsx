import { useEffect, useRef } from "react";
import { HIGHLIGHT_COLORS, colorToBg } from "@/components/editor/plugins/highlight/index";
import { popoverShellClass } from "@/components/ui/popover";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { cn } from "@/shared/utils/cn";

interface HighlightPickerProps {
  anchorRect: DOMRect;
  /** Hex color, or null to remove the highlight. */
  onSelect: (color: string | null) => void;
  onClose: () => void;
}

// Phosphor Eraser, 16x16.
const ERASER_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 256 256"
    fill="currentColor"
  >
    <path d="M225,80.4,183.6,39a24,24,0,0,0-33.94,0L31,157.66a24,24,0,0,0,0,33.94l30.06,30.06A8,8,0,0,0,66.74,224H216a8,8,0,0,0,0-16h-84.7L225,114.34A24,24,0,0,0,225,80.4ZM213.67,103,160,156.69,107.31,104,161,50.34a8,8,0,0,1,11.32,0l41.38,41.38A8,8,0,0,1,213.67,103Z" />
  </svg>
);

export function HighlightPicker({ anchorRect, onSelect, onClose }: HighlightPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useOverlayEscape(onClose);

  // Position below the selection
  const top = anchorRect.bottom + 8;
  const left = anchorRect.left + anchorRect.width / 2;

  return (
    <div
      ref={pickerRef}
      className={cn(popoverShellClass, "fixed z-[1001] flex items-center gap-1.5 p-2")}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
      }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          title={color.name}
          className="focus-ring flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
          style={{ backgroundColor: colorToBg(color.value) }}
          onClick={() => onSelect(color.value)}
        >
          <span className="block h-3 w-3 rounded-full" style={{ backgroundColor: color.value }} />
        </button>
      ))}

      {/* Divider */}
      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Remove highlight */}
      <button
        type="button"
        title="Remove highlight"
        className="focus-ring flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => onSelect(null)}
      >
        {ERASER_ICON}
      </button>
    </div>
  );
}
