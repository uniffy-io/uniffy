import * as React from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";

interface SearchFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value" | "size"
> {
  value: string;
  onChange: (value: string) => void;
  /** `sm` fits a pane header bar; `md` is the form-control default. */
  size?: "sm" | "md";
  /** Shows a clear control while the field has text. */
  clearable?: boolean;
  containerClassName?: string;
}

/** Text input with the search glyph and an optional clear control. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    { value, onChange, size = "md", clearable = true, className, containerClassName, ...props },
    ref,
  ) => {
    const small = size === "sm";
    return (
      <div className={cn("relative", containerClassName)}>
        <MagnifyingGlass
          size={small ? 14 : 16}
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-subtle-foreground",
            small ? "left-2.5" : "left-3",
          )}
        />
        <Input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            small ? "h-8 pl-8 text-xs" : "h-9 pl-9",
            clearable && value && (small ? "pr-7" : "pr-9"),
            className,
          )}
          {...props}
        />
        {clearable && value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 rounded text-subtle-foreground transition-colors hover:text-foreground",
              small ? "right-2" : "right-3",
            )}
            aria-label="Clear search"
          >
            <X size={small ? 12 : 14} weight="bold" />
          </button>
        )}
      </div>
    );
  },
);

SearchField.displayName = "SearchField";
