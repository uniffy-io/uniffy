import React from "react";
import { cn } from "@/shared/utils/cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "warning";
  size?: "xs" | "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "default", size = "sm", loading = false, children, disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "relative inline-flex items-center justify-center gap-1.5 rounded-lg font-medium",
          "tracking-[-0.01em] select-none",
          "transition-all duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-40",
          "hover:-translate-y-px",
          "active:translate-y-0 active:scale-[0.97]",
          "cursor-pointer",

          variant === "default" && [
            "bg-primary text-primary-foreground",
            "border border-white/[0.08]",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.1),0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.08)]",
            "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-1px_0_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.1)]",
            "hover:brightness-[1.08]",
            "active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.15),0_0_0_0.5px_rgba(0,0,0,0.08)]",
            "active:brightness-[0.96]",
          ],

          variant === "secondary" && [
            "bg-muted/70 text-foreground",
            "border border-border/60",
            "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_0.5px_rgba(0,0,0,0.04)]",
            "hover:bg-muted hover:border-border/80",
            "hover:shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.06)]",
            "active:bg-muted/90 active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
          ],

          variant === "outline" && [
            "bg-transparent text-foreground",
            "border border-border/70",
            "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_0_0_0.5px_rgba(0,0,0,0.04)]",
            "hover:bg-muted/40 hover:border-border",
            "hover:shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.06)]",
            "active:bg-muted/60 active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
          ],

          variant === "ghost" && [
            "text-muted-foreground",
            "hover:bg-muted/50 hover:text-foreground hover:translate-y-0",
            "active:bg-muted/70",
          ],

          variant === "destructive" && [
            "bg-red-600 text-white dark:bg-red-600",
            "border border-red-500/20",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.1),0_1px_3px_rgba(220,38,38,0.2),0_0_0_0.5px_rgba(220,38,38,0.12)]",
            "hover:bg-red-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(220,38,38,0.25),0_0_0_0.5px_rgba(220,38,38,0.15)]",
            "active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2),0_0_0_0.5px_rgba(220,38,38,0.12)]",
          ],

          variant === "warning" && [
            "bg-amber-600 text-white dark:bg-amber-600",
            "border border-amber-500/20",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.1),0_1px_3px_rgba(217,119,6,0.2),0_0_0_0.5px_rgba(217,119,6,0.12)]",
            "hover:bg-amber-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(217,119,6,0.25),0_0_0_0.5px_rgba(217,119,6,0.15)]",
            "active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2),0_0_0_0.5px_rgba(217,119,6,0.12)]",
          ],

          size === "xs" && "h-6 px-2 text-xs",
          size === "sm" && "h-7 px-2.5 text-[13px]",
          size === "md" && "h-8 px-3.5 text-[13px]",
          size === "lg" && "h-9 px-4 text-sm",
          size === "icon" && "h-7 w-7 p-0",

          className,
        )}
        {...props}
      >
        {loading ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-60" />
            {children}
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
