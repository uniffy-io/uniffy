import type { Icon } from "@phosphor-icons/react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";

/**
 * The shell every `/agents` section browses through: a titled header carrying
 * its own search plus a card grid. The sidebar only picks the section, so each
 * section owns its filtering and its primary action.
 */
export function BrowseHeader({
  title,
  subtitle,
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  action,
  testId,
}: {
  title: string;
  subtitle?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="border-b border-border/60 bg-card px-6 py-4" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {onSearchChange && (
          <div className="relative w-full sm:w-64">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 text-xs"
              data-testid={testId ? `${testId}-search` : undefined}
            />
          </div>
        )}
        {action}
      </div>
    </div>
  );
}

export function BrowseBody({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid={testId}>
      {children}
    </div>
  );
}

export function BrowseGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

export function BrowseGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </h2>
  );
}

/**
 * One card in a browse grid. `leading` takes an avatar or a tinted icon box,
 * `chips` the metadata row, `footer` the hover affordance and any per-item
 * action; a click anywhere else opens the item.
 */
export function BrowseCard({
  onOpen,
  leading,
  title,
  subtitle,
  badges,
  chips,
  footer,
  dimmed = false,
  testId,
}: {
  onOpen: () => void;
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  chips?: React.ReactNode;
  footer?: React.ReactNode;
  dimmed?: boolean;
  testId?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid={testId}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left",
        "cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className={cn("flex items-start gap-3", dimmed && "opacity-60")}>
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
            {badges}
          </div>
          {subtitle && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {chips && <div className="flex flex-wrap items-center gap-1">{chips}</div>}

      {footer && <div className="mt-auto flex items-center justify-between pt-1">{footer}</div>}
    </div>
  );
}

export function BrowseEmpty({
  icon: EmptyIcon,
  title,
  description,
  action,
  testId,
}: {
  icon: Icon;
  title: string;
  description: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center py-12 text-center" data-testid={testId}>
      <EmptyIcon size={40} weight="light" className="mb-3 text-muted-foreground/30" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
