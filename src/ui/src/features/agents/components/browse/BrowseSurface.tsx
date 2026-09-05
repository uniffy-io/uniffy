import { CircleNotch, type Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { SearchField } from "@/components/ui/search-field";

/**
 * The shell every `/agents` section browses through: a titled header carrying
 * its own search plus a card grid. The sidebar only picks the section, so each
 * section owns its filtering and its primary action.
 */
export function BrowseHeader({
  icon,
  title,
  subtitle,
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  action,
  testId,
}: {
  icon?: Icon | React.ReactNode;
  title: string;
  subtitle?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <PaneHeader data-testid={testId}>
      <PaneHeaderBar icon={icon} title={title} subtitle={subtitle}>
        {onSearchChange && (
          <SearchField
            size="sm"
            value={search ?? ""}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            containerClassName="w-64"
            data-testid={testId ? `${testId}-search` : undefined}
          />
        )}
        {action}
      </PaneHeaderBar>
    </PaneHeader>
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
        "focus-ring",
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

export function BrowsePaneSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <CircleNotch size={32} className="animate-spin text-muted-foreground" />
    </div>
  );
}

/** Full-pane notice for a detail route whose item is missing or already handled. */
export function BrowsePaneMessage({
  icon: MessageIcon,
  title,
  description,
}: {
  icon: Icon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-1 items-center justify-center px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <MessageIcon size={48} weight="light" className="text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}
