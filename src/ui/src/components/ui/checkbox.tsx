import { forwardRef, useCallback, useEffect, useId, useRef } from "react";
import { Check, Minus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: string;
  description?: string;
  /** `sm` for dense rows (table, board, roadmap), `md` everywhere else. */
  size?: "sm" | "md";
  /** Mixed state for a select-all control: some but not all of its targets are checked. */
  indeterminate?: boolean;
  /** Classes for the label text, e.g. `truncate` for a one-line control inside a toolbar. */
  labelClassName?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      label,
      labelClassName,
      description,
      id,
      checked,
      size = "md",
      indeterminate = false,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const checkboxId = id || generatedId;
    const inputRef = useRef<HTMLInputElement | null>(null);

    const attachInput = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    return (
      <div className={cn("flex items-start gap-3", className)}>
        <div className="relative flex items-center">
          <input
            ref={attachInput}
            type="checkbox"
            id={checkboxId}
            checked={checked}
            className="peer sr-only"
            {...props}
          />
          <div
            className={cn(
              "focus-ring rounded border-2 border-border bg-input transition-all duration-150 cursor-pointer",
              "flex items-center justify-center",
              "hover:border-border-strong",
              "peer-checked:border-primary peer-checked:bg-primary peer-checked:hover:border-primary",
              "peer-indeterminate:border-primary peer-indeterminate:bg-primary peer-indeterminate:hover:border-primary",
              "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
              size === "sm" ? "h-4 w-4" : "h-5 w-5",
            )}
            onClick={(event) => {
              // The box stands in for the hidden input, so its own click is
              // swallowed: only the input's click reaches a clickable ancestor.
              event.stopPropagation();
              const input = inputRef.current;
              if (input && !input.disabled) {
                input.click();
              }
            }}
          >
            {indeterminate && !checked ? (
              <Minus
                size={size === "sm" ? 11 : 14}
                weight="bold"
                className="text-primary-foreground"
              />
            ) : (
              <Check
                size={size === "sm" ? 11 : 14}
                weight="bold"
                className={cn(
                  "text-primary-foreground transition-opacity duration-150",
                  checked ? "opacity-100" : "opacity-0",
                )}
              />
            )}
          </div>
        </div>
        {(label || description) && (
          <div className="flex min-w-0 flex-col">
            {label && (
              <label
                htmlFor={checkboxId}
                className={cn(
                  "text-sm font-medium text-foreground cursor-pointer select-none",
                  labelClassName,
                )}
              >
                {label}
              </label>
            )}
            {description && <span className="text-xs text-muted-foreground">{description}</span>}
          </div>
        )}
      </div>
    );
  },
);

Checkbox.displayName = "Checkbox";
