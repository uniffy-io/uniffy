import * as React from "react";
import { cn } from "@/shared/utils/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * One rung above the surface it sits on: `surface` for section panes on the
   * app frame (`bg-background` pages such as settings, admin, dashboard),
   * `card` for item cards on a content sheet (`bg-surface`).
   */
  tone?: "card" | "surface";
}

/** Raised block. The edge is a shadow ring, never a CSS border. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = "card", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl text-card-foreground shadow-edge",
        tone === "surface" ? "bg-surface" : "bg-card",
        className,
      )}
      {...props}
    />
  ),
);

Card.displayName = "Card";
