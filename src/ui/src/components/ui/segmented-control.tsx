import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Icon or short label. */
  content: ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  ariaLabel?: string;
}

/** Bordered pill of exclusive choices, the accent wash marks the active one. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-ring rounded p-1 transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}
