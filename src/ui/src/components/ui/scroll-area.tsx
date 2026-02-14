/**
 * ScrollArea - A scrollable container component
 *
 * Provides a styled scrollable area with optional custom scrollbar styling.
 */

import * as React from "react";
import { cn } from "@/shared/utils/cn";

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div
      className={cn(
        "overflow-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
