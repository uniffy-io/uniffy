import * as React from "react";
import { cn } from "@/shared/utils/cn";
import { controlShellClass, controlTextClass } from "@/components/ui/input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line sibling of `Input`; `rows` drives the height, resizing is opt-in via className. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        controlShellClass,
        controlTextClass,
        "focus-ring flex w-full resize-none px-3 py-2",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
