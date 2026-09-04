import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { popoverShellClass } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { cn } from "@/shared/utils/cn";
import type { TocAttrs } from "@/components/editor/plugins/toc/tocTypes";

interface TocConfigPopoverProps {
  anchorRect: DOMRect;
  attrs: TocAttrs;
  onChange: (patch: Partial<TocAttrs>) => void;
  onClose: () => void;
}

const LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `H${n}` }));
const STYLE_OPTIONS = [
  { value: "flat", label: "Flat" },
  { value: "nested", label: "Nested" },
] as const;
const BULLET_OPTIONS = [
  { value: "none", label: "None" },
  { value: "disc", label: "Bullet" },
  { value: "dash", label: "Dash" },
  { value: "number", label: "Number" },
] as const;

export function TocConfigPopover({ anchorRect, attrs, onChange, onClose }: TocConfigPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      // Allow Select portal interactions to bubble through.
      if ((target as HTMLElement | null)?.closest?.("[data-select-portal]")) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useOverlayEscape(onClose);

  const top = anchorRect.bottom + 6;
  const left = Math.max(8, anchorRect.right - 240);

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: "fixed", top, left, width: 240 }}
      className={cn(
        popoverShellClass,
        "z-[200] p-3",
        "animate-in fade-in-0 slide-in-from-top-1 duration-100",
      )}
      contentEditable={false}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <Select<number>
            value={attrs.min}
            onChange={(min) => onChange({ min: Math.min(min, attrs.max) })}
            options={LEVEL_OPTIONS}
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <Select<number>
            value={attrs.max}
            onChange={(max) => onChange({ max: Math.max(max, attrs.min) })}
            options={LEVEL_OPTIONS}
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">Style</label>
          <Select<TocAttrs["style"]>
            value={attrs.style}
            onChange={(style) => onChange({ style })}
            options={
              STYLE_OPTIONS as unknown as {
                value: TocAttrs["style"];
                label: string;
              }[]
            }
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">Bullets</label>
          <Select<TocAttrs["bullets"]>
            value={attrs.bullets}
            onChange={(bullets) => onChange({ bullets })}
            options={
              BULLET_OPTIONS as unknown as {
                value: TocAttrs["bullets"];
                label: string;
              }[]
            }
            size="sm"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
