import { useCallback, useEffect, useState } from "react";
import { Buildings } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyErrorMessage } from "@/config";
import { adminApi } from "@/features/admin/api/adminApi";
import { DeleteOrganizationDialog } from "@/features/admin/components/organization/DeleteOrganizationDialog";
import { LeaveOrganizationCard } from "@/features/auth/components/LeaveOrganizationCard";
import { OrganizationGeneralForm } from "@/features/admin/components/organization/OrganizationGeneralForm";
import type { OrganizationFields } from "@/features/admin/components/organization/organizationChanges";
import { OwnershipTransferDialog } from "@/features/admin/components/organization/OwnershipTransferDialog";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

interface LoadedOrganization extends OrganizationFields {
  id: string;
}

export function OrganizationSection() {
  useDocumentTitle("Organization");
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);

  const [organization, setOrganization] = useState<LoadedOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"transfer" | "delete" | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.getOrganization({ organizationId });
      const info = response.organization?.organization;
      setOrganization(info ? { id: info.id, name: info.name, slug: info.slug } : null);
      if (!info) setError("Could not load this organization.");
    } catch (err) {
      setError(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not load this organization.",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Buildings size={24} weight="duotone" className="shrink-0 text-primary" />
          <h1 className="text-xl font-bold md:text-2xl">Organization</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          The name, slug and owner of this organization.
        </p>
      </div>

      {!organization ? (
        loading || !error ? (
          <Card tone="surface" className="space-y-4 p-4 md:p-6">
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Skeleton variant="rectangular" className="h-10 w-full" />
              <Skeleton variant="rectangular" className="h-10 w-full" />
            </div>
          </Card>
        ) : (
          <Card
            tone="surface"
            className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground md:p-6"
          >
            {error}
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Retry
            </Button>
          </Card>
        )
      ) : (
        <>
          <OrganizationGeneralForm
            key={organization.id}
            organizationId={organization.id}
            saved={organization}
            onSaved={(fields) => setOrganization({ ...organization, ...fields })}
          />

          {role && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Danger zone
              </h2>
              {role === "OWNER" ? (
                <Card tone="surface" className="divide-y divide-border/60">
                  <DangerRow
                    title="Transfer ownership"
                    description="Hand this organization to another member. You stay as an admin."
                  >
                    <Button variant="outline" size="md" onClick={() => setDialog("transfer")}>
                      Transfer ownership
                    </Button>
                  </DangerRow>
                  <DangerRow
                    title="Delete organization"
                    description="Everyone loses access. A platform operator can restore it during the purge window."
                  >
                    <Button variant="destructive" size="md" onClick={() => setDialog("delete")}>
                      Delete organization
                    </Button>
                  </DangerRow>
                </Card>
              ) : (
                <LeaveOrganizationCard
                  organizationId={organization.id}
                  organizationName={organization.name}
                />
              )}
            </section>
          )}

          {dialog === "transfer" && (
            <OwnershipTransferDialog
              organizationId={organization.id}
              organizationName={organization.name}
              onClose={() => setDialog(null)}
              onTransferred={() => {
                setDialog(null);
                void reload();
              }}
            />
          )}
          {dialog === "delete" && (
            <DeleteOrganizationDialog
              organizationId={organization.id}
              organization={organization}
              onClose={() => setDialog(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function DangerRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center md:p-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
