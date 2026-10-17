import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
  children: ReactNode;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ active = false, label, children, className, disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 h-8 min-w-8 px-2 rounded text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          active && "text-primary bg-primary/10 hover:bg-primary/15",
          disabled &&
            "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

ToolbarButton.displayName = "ToolbarButton";

export function ToolbarSeparator() {
  return <span aria-hidden="true" className="self-stretch w-px bg-border/60 mx-1" />;
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}
