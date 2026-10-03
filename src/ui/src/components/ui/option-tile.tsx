import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

interface OptionTileProps {
  selected: boolean;
  icon: ReactNode;
  label: string;
  description: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** One choice in a `role="radiogroup"` of described options; the picked tile carries the accent edge. */
export function OptionTile({
  selected,
  icon,
  label,
  description,
  onSelect,
  disabled = false,
}: OptionTileProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "focus-ring flex items-start gap-3 rounded-lg bg-card p-3 text-left transition-shadow",
        selected ? "bg-primary/5 shadow-edge-primary" : "shadow-edge hover:shadow-edge-strong",
        disabled && "cursor-not-allowed opacity-50 hover:shadow-edge",
      )}
    >
      <span className={cn("mt-0.5", selected ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
