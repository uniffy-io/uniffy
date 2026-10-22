import { Check, CircleNotch } from "@phosphor-icons/react";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import type { OrganizationSummary } from "@/features/auth/store/organizationsSlice";
import { getRoleBadgeClasses, getRoleLabel } from "@/features/auth/utils/organizationRoles";
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
  compact?: boolean;
}

export function OrganizationList({
  organizations,
  currentOrganizationId,
  switchingSlug,
  disabled = false,
  onSelect,
  compact = false,
}: OrganizationListProps) {
  const isBusy = switchingSlug !== null || disabled;

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
                className={
                  compact ? "h-6 w-6 rounded-md text-[10px]" : "h-8 w-8 rounded-lg text-xs"
                }
              />

              {compact ? (
                <>
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
                </>
              ) : (
                <span className="flex-1 min-w-0">
                  <span className={cn("block truncate", isCurrent && "font-medium")}>
                    {organization.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold",
                        getRoleBadgeClasses(organization.role),
                      )}
                    >
                      {getRoleLabel(organization.role)}
                    </span>
                    {isSuspended && <SuspendedBadge />}
                  </span>
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
