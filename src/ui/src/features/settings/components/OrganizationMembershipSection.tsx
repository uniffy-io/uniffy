import { Link } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LeaveOrganizationCard } from "@/features/auth/components/LeaveOrganizationCard";
import { OrganizationAvatar } from "@/features/auth/components/OrganizationList";
import {
  selectCurrentOrganization,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import { getRoleBadgeClasses, getRoleLabel } from "@/features/auth/utils/organizationRoles";
import { cn } from "@/shared/utils/cn";

export function OrganizationMembershipSection() {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const slug = useAppSelector((state) => state.auth.currentOrganizationSlug);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const organization = useAppSelector(selectCurrentOrganization);
  const listStatus = useAppSelector(selectOrganizationsStatus);

  // The name comes from the membership list; once it has loaded without this organization, the
  // tab's slug stands in.
  const listPending = listStatus === "idle" || listStatus === "loading";
  const name = organization?.name || (listPending ? null : slug);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-xl font-bold text-foreground md:text-2xl">Organization</h1>
        <p className="text-muted-foreground">The organization this tab is signed in to.</p>
      </div>

      <Card tone="surface" className="flex items-center gap-3 p-4 md:p-6">
        {name ? (
          <OrganizationAvatar name={name} className="h-10 w-10 rounded-lg text-sm" />
        ) : (
          <Skeleton variant="rectangular" className="h-10 w-10 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {name ? (
            <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          ) : (
            <Skeleton className="h-4 w-40" />
          )}
          {slug && <p className="mt-0.5 truncate text-sm text-muted-foreground">{slug}</p>}
        </div>
        {organization && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold",
              getRoleBadgeClasses(organization.role),
            )}
          >
            {getRoleLabel(organization.role)}
          </span>
        )}
      </Card>

      {organizationId &&
        name &&
        role &&
        (role === "OWNER" ? (
          <Card tone="surface" className="p-4 text-sm text-muted-foreground md:p-6">
            You own this organization. Transfer ownership or delete it from{" "}
            <Link to="/admin/organization" className="text-primary hover:underline">
              Organization settings
            </Link>
            .
          </Card>
        ) : (
          <LeaveOrganizationCard organizationId={organizationId} organizationName={name} />
        ))}
    </div>
  );
}
