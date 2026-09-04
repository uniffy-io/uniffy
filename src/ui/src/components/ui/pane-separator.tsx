import { Separator } from "react-resizable-panels";
import { cn } from "@/shared/utils/cn";

interface PaneSeparatorProps {
  className?: string;
  /** Static divider for panes that do not resize. */
  static?: boolean;
}

/**
 * Seam between two panes: a 1px line with a 4px grab area. The line lifts to
 * the accent while hovered or dragged so the handle is discoverable without
 * drawing a bar across the layout.
 */
export function PaneSeparator({ className, static: isStatic = false }: PaneSeparatorProps) {
  const classes = cn(
    "group/seam relative w-1 shrink-0 bg-transparent",
    "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border-strong before:transition-colors",
    !isStatic && [
      "cursor-col-resize",
      "hover:before:bg-primary/60",
      "data-[resize-handle-state=drag]:before:bg-primary data-[resize-handle-state=drag]:before:w-0.5",
    ],
    className,
  );
  if (isStatic) return <div className={classes} aria-hidden="true" />;
  return <Separator className={classes} />;
}
