import * as React from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Shell for anything that floats over the page: menus, pickers, hover cards,
 * search popups. Same tone as the sheet, separated by the float shadow (a
 * strong ring plus a wide soft drop), never by a CSS border.
 */
export const popoverShellClass = "rounded-lg bg-popover text-popover-foreground shadow-float";

/** Entrance for a popover anchored to a trigger. */
export const popoverEnterClass = "animate-in fade-in-0 zoom-in-95 duration-100";

/** Heavier tier for dialogs and drawers, which cover more of the page. */
export const dialogShellClass = "bg-surface text-foreground shadow-float-lg";

export type PopoverProps = React.HTMLAttributes<HTMLDivElement>;

export const Popover = React.forwardRef<HTMLDivElement, PopoverProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn(popoverShellClass, className)} {...props} />
  ),
);

Popover.displayName = "Popover";
