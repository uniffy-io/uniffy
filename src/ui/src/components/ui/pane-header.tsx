import * as React from "react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

/**
 * The header band of a content pane (projects, notifications, agents, ...):
 * a bar with a leading icon, title, subtitle, and right-aligned actions, plus
 * an optional controls row beneath it. One shell so every domain reads alike.
 */
export function PaneHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shrink-0 border-b border-border-strong bg-surface", className)}
      {...props}
    />
  );
}

interface PaneHeaderBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Chrome that sits before the icon, such as a sidebar toggle. */
  leading?: React.ReactNode;
  /** Phosphor icon drawn in the accent, or any leading node (avatar, icon box). */
  icon?: Icon | React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Small row above the bar, typically a back link. */
  eyebrow?: React.ReactNode;
  /** Draws the seam under the bar when a controls row follows. */
  divided?: boolean;
}

function isPhosphorIcon(icon: PaneHeaderBarProps["icon"]): icon is Icon {
  return (
    typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon)
  );
}

export function PaneHeaderBar({
  leading,
  icon,
  title,
  subtitle,
  eyebrow,
  divided = false,
  className,
  children,
  ...props
}: PaneHeaderBarProps) {
  let iconNode: React.ReactNode;
  if (isPhosphorIcon(icon)) {
    const IconComponent = icon;
    iconNode = <IconComponent size={20} weight="duotone" className="shrink-0 text-primary" />;
  } else {
    iconNode = icon;
  }
  return (
    <div className={cn(divided && "border-b border-border", className)} {...props}>
      {eyebrow && (
        <div className="flex items-center gap-3 px-3 pt-2 md:px-4 md:pt-3">{eyebrow}</div>
      )}
      <div className="flex items-center gap-2 px-3 py-2 md:gap-3 md:px-4 md:py-3">
        {leading}
        {iconNode}
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-sm font-medium text-foreground md:text-base">
            {title}
          </h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The controls row under the bar: filters, view switchers, bulk actions. */
export const PaneHeaderControls = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-wrap items-center gap-2 px-3 py-2 md:gap-3 md:px-4", className)}
    {...props}
  />
));
PaneHeaderControls.displayName = "PaneHeaderControls";

/** Back link for the eyebrow slot. */
export function PaneBackLink({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export const paneIconButtonClass =
  "shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** Icon-only action in a pane header; `active` paints it in the accent. */
export const PaneIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active = false, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      paneIconButtonClass,
      "focus-ring",
      active && "text-primary hover:bg-primary/10 hover:text-primary",
      className,
    )}
    {...props}
  />
));
PaneIconButton.displayName = "PaneIconButton";
