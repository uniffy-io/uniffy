import * as React from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Shell every form control shares: one fill, a resting edge, a stronger edge on
 * hover. Pair with `focus-ring` on the control itself or `focus-ring-within` on
 * a box that wraps a bare input.
 */
export const controlShellClass =
  "rounded-md border border-border bg-input transition-colors hover:border-border-strong";

export const controlTextClass =
  "text-sm text-foreground placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, id, name, ...props }, ref) => {
    const reactId = React.useId();
    const resolvedId = id ?? (name ? undefined : reactId);
    return (
      <input
        ref={ref}
        type={type}
        id={resolvedId}
        name={name}
        className={cn(
          controlShellClass,
          controlTextClass,
          "focus-ring flex h-10 w-full px-3 py-2",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
