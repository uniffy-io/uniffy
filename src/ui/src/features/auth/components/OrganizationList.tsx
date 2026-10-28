import { ArrowRight, Check, CircleNotch } from "@phosphor-icons/react";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import type { OrganizationSummary } from "@/features/auth/store/organizationsSlice";
import { getRoleLabel } from "@/features/auth/utils/organizationRoles";
import { cn } from "@/shared/utils/cn";

interface OrganizationAvatarProps {
  name: string;
  suspended?: boolean;
  className?: string;
}

/** Initials tile on the identity gradient, so an organization reads the same in every list. */
export function OrganizationAvatar({
  name,
  suspended = false,
  className,
}: OrganizationAvatarProps) {
  const label = name || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white",
        suspended && "grayscale opacity-60",
        className,
      )}
      style={getAvatarGradientStyle(label)}
    >
      {getInitials(label)}
    </span>
  );
}

interface OrganizationListProps {
  organizations: OrganizationSummary[];
  currentOrganizationId: string | null;
  switchingSlug: string | null;
  /** Holds every row, as a switch in flight does, while other work is about to switch the tab. */
  disabled?: boolean;
  onSelect: (slug: string) => void;
  /** Hover and focus report the row in view, so a page can light it up elsewhere. */
  onHighlight?: (slug: string | null) => void;
  /** Menu rows for app chrome; without it the rows are the welcome page's brand tiles. */
  compact?: boolean;
}

export function OrganizationList({
  organizations,
  currentOrganizationId,
  switchingSlug,
  disabled = false,
  onSelect,
  onHighlight,
  compact = false,
}: OrganizationListProps) {
  const isBusy = switchingSlug !== null || disabled;

  if (!compact) {
    return (
      <ul className="flex flex-col gap-2">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <OrganizationTile
              organization={organization}
              isCurrent={organization.id === currentOrganizationId}
              isSwitching={organization.slug === switchingSlug}
              isBusy={isBusy}
              onSelect={onSelect}
              onHighlight={onHighlight}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {organizations.map((organization) => {
        const isCurrent = organization.id === currentOrganizationId;
        const isSwitching = organization.slug === switchingSlug;
        const isSuspended = organization.suspended;
        const isInteractive = !isSuspended && !isBusy;

        return (
          <li key={organization.id}>
            <button
              type="button"
              title={organization.name}
              aria-current={isCurrent ? "true" : undefined}
              aria-disabled={isSuspended ? "true" : undefined}
              aria-busy={isSwitching ? "true" : undefined}
              disabled={!isSuspended && isBusy}
              onClick={isSuspended ? undefined : () => onSelect(organization.slug)}
              className={cn(
                "group relative flex w-full min-h-11 md:min-h-0 items-center gap-2.5 px-2.5 py-2 text-left text-sm rounded-md transition-colors overflow-hidden focus-ring",
                isSuspended
                  ? "cursor-not-allowed text-muted-foreground"
                  : isCurrent
                    ? "text-foreground"
                    : "text-foreground/80 hover:text-foreground",
                isBusy && !isSwitching && "opacity-60",
              )}
            >
              {isInteractive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
              )}

              <OrganizationAvatar
                name={organization.name}
                suspended={isSuspended}
                className="h-6 w-6 rounded-md text-[10px]"
              />

              <span className={cn("flex-1 min-w-0 truncate", isCurrent && "font-medium")}>
                {organization.name}
              </span>
              {isSuspended ? (
                <SuspendedBadge />
              ) : (
                <span className="shrink-0 text-[10px] font-medium text-subtle-foreground">
                  {getRoleLabel(organization.role)}
                </span>
              )}

              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {isSwitching ? (
                  <CircleNotch
                    size={14}
                    weight="bold"
                    className="animate-spin text-primary"
                    aria-hidden="true"
                  />
                ) : isCurrent ? (
                  <Check size={14} weight="bold" className="text-primary" aria-hidden="true" />
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SuspendedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
      Suspended
    </span>
  );
}

interface OrganizationTileProps {
  organization: OrganizationSummary;
  isCurrent: boolean;
  isSwitching: boolean;
  isBusy: boolean;
  onSelect: (slug: string) => void;
  onHighlight?: (slug: string | null) => void;
}

/** A welcome page row: a raised surface tile that lifts its edge on hover and wears the accent when current. */
function OrganizationTile({
  organization,
  isCurrent,
  isSwitching,
  isBusy,
  onSelect,
  onHighlight,
}: OrganizationTileProps) {
  const isSuspended = organization.suspended;
  const highlight = isSuspended ? undefined : () => onHighlight?.(organization.slug);
  const clear = isSuspended ? undefined : () => onHighlight?.(null);
  return (
    <button
      type="button"
      title={organization.name}
      aria-current={isCurrent ? "true" : undefined}
      aria-disabled={isSuspended ? "true" : undefined}
      aria-busy={isSwitching ? "true" : undefined}
      disabled={!isSuspended && isBusy}
      onClick={isSuspended ? undefined : () => onSelect(organization.slug)}
      onPointerEnter={highlight}
      onPointerLeave={clear}
      onFocus={highlight}
      onBlur={clear}
      className={cn(
        "focus-ring group flex w-full min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-shadow duration-150",
        isCurrent ? "bg-primary/5 shadow-edge-primary" : "bg-surface shadow-edge",
        !isSuspended && !isCurrent && "hover:shadow-edge-strong",
        isSuspended && "cursor-not-allowed",
        isBusy && !isSwitching && "opacity-60",
      )}
    >
      <OrganizationAvatar
        name={organization.name}
        suspended={isSuspended}
        className="h-9 w-9 rounded-lg text-xs"
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            isSuspended ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {organization.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">@{organization.slug}</span>
          <span className="text-subtle-foreground" aria-hidden="true">
            &middot;
          </span>
          <span className="shrink-0">{getRoleLabel(organization.role)}</span>
          {isSuspended && <SuspendedBadge />}
        </span>
      </span>
      <span className="flex shrink-0 items-center">
        {isSwitching ? (
          <CircleNotch
            size={16}
            weight="bold"
            className="animate-spin text-primary"
            aria-hidden="true"
          />
        ) : isCurrent ? (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <Check size={12} weight="bold" aria-hidden="true" />
            Current
          </span>
        ) : isSuspended ? null : (
          <ArrowRight
            size={16}
            className="-translate-x-1 text-subtle-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </span>
    </button>
  );
}
