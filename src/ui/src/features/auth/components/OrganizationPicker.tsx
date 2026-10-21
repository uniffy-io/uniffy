import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Buildings,
  Check,
  CircleNotch,
  ShieldWarning,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { OrganizationAvatar } from "@/features/auth/components/OrganizationList";
import { useSignOut } from "@/features/auth/hooks/useSignOut";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import {
  selectOrganizations,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import { fetchMyOrganizations } from "@/features/auth/store/organizationsThunks";
import { getRoleBadgeClasses, getRoleLabel } from "@/features/auth/utils/organizationRoles";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";

export function OrganizationPicker() {
  useDocumentTitle("Select Organization");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const user = useAppSelector((state) => state.auth?.user);
  const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);
  const organizations = useAppSelector(selectOrganizations);
  const status = useAppSelector(selectOrganizationsStatus);
  const switchingSlug = useAppSelector((state) => state.organizations.switchingSlug);
  const handleLogout = useSignOut();
  const { requestSwitch, confirmDialog } = useSwitchOrganization();
  const [confirmingUnsynced, setConfirmingUnsynced] = useState(false);

  useEffect(() => {
    if (isAuthenticated) void dispatch(fetchMyOrganizations());
  }, [dispatch, isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  const hasOrganizations = organizations.length > 0;
  const isLoading = !hasOrganizations && (status === "idle" || status === "loading");
  const loadFailed = !hasOrganizations && status === "error";

  return (
    <>
      <style>{`
        @keyframes org-slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes org-spinner {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {confirmDialog}

      <ConfirmDialog
        isOpen={confirmingUnsynced}
        onClose={() => setConfirmingUnsynced(false)}
        onConfirm={() => {
          setConfirmingUnsynced(false);
          handleLogout({ discardUnsynced: true });
        }}
        title="Discard unsynced edits?"
        message="Some edits have not reached the server yet. Signing out now discards them."
        confirmLabel="Discard and sign out"
        cancelLabel="Stay"
        variant="warning"
      />

      <div className="flex min-h-screen items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-md">
          <div
            className="flex items-center justify-between mb-8 opacity-0"
            style={{ animation: "org-slide-up 0.5s ease-out 0.1s forwards" }}
          >
            <div className="flex items-center gap-3">
              <UniffyLogo className="w-14 h-14" />
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground">
                  Select an organization
                </h1>
                <p className="text-xs text-muted-foreground">
                  {user?.email || "Choose where to continue"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleLogout().then((signedOut) => {
                  if (!signedOut) setConfirmingUnsynced(true);
                });
              }}
              className="gap-1.5 text-muted-foreground"
            >
              <SignOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>

          {isLoading ? (
            <div
              className="flex flex-col items-center justify-center py-16 opacity-0"
              style={{ animation: "org-slide-up 0.5s ease-out 0.2s forwards" }}
            >
              <CircleNotch
                className="h-8 w-8 text-primary mb-4"
                style={{ animation: "org-spinner 0.8s linear infinite" }}
                weight="bold"
              />
              <p className="text-sm text-muted-foreground">Loading organizations...</p>
            </div>
          ) : loadFailed ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
              style={{ animation: "org-slide-up 0.3s ease-out forwards" }}
            >
              <WarningCircle className="h-4 w-4 mt-0.5 flex-shrink-0" weight="fill" />
              <span className="flex-1">Your organizations could not be loaded.</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void dispatch(fetchMyOrganizations())}
                className="-my-1"
              >
                Retry
              </Button>
            </div>
          ) : !hasOrganizations ? (
            <Card
              tone="surface"
              className="p-10 text-center opacity-0"
              style={{ animation: "org-slide-up 0.5s ease-out 0.2s forwards" }}
            >
              <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <Buildings className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-foreground font-medium mb-1">No organizations yet</p>
              <p className={cn("text-sm text-muted-foreground", user?.isSystemAdmin && "mb-6")}>
                {user?.isSystemAdmin
                  ? "You are a platform operator with no tenant membership. Open the platform console to manage the deployment."
                  : "Ask an organization admin to invite you."}
              </p>
              {user?.isSystemAdmin && (
                <Button variant="default" className="gap-2" onClick={() => navigate("/platform")}>
                  <ShieldWarning className="h-4 w-4" weight="duotone" />
                  Open platform console
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-2">
              {user?.isSystemAdmin && (
                <button
                  type="button"
                  onClick={() => navigate("/platform")}
                  className="w-full text-left rounded-xl bg-surface shadow-edge hover:shadow-edge-strong transition-shadow duration-150 group cursor-pointer opacity-0"
                  style={{
                    animation: "org-slide-up 0.4s ease-out 0.1s forwards",
                  }}
                >
                  <div className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                      <ShieldWarning
                        className="h-5 w-5 text-amber-700 dark:text-amber-300"
                        weight="duotone"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground">Platform console</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Cross-tenant operator view (no org context)
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground/0 group-hover:text-muted-foreground transition-all duration-200 -translate-x-1 group-hover:translate-x-0" />
                  </div>
                </button>
              )}
              {organizations.map((organization, index) => {
                const isSelecting = switchingSlug === organization.slug;
                const isCurrent = organization.id === currentOrganizationId;
                const isSuspended = organization.suspended;

                return (
                  <button
                    key={organization.id}
                    type="button"
                    onClick={isSuspended ? undefined : () => void requestSwitch(organization.slug)}
                    disabled={!isSuspended && switchingSlug !== null}
                    aria-disabled={isSuspended ? "true" : undefined}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "w-full text-left rounded-xl transition-shadow duration-150 group opacity-0",
                      isSuspended
                        ? "bg-muted shadow-edge cursor-not-allowed"
                        : isSelecting || isCurrent
                          ? "bg-primary/5 shadow-edge-primary cursor-pointer"
                          : "bg-surface shadow-edge hover:shadow-edge-strong cursor-pointer",
                      switchingSlug !== null && !isSelecting && "opacity-60",
                    )}
                    style={{
                      animation: `org-slide-up 0.4s ease-out ${0.15 + index * 0.06}s forwards`,
                    }}
                  >
                    <div className="flex items-center gap-4 p-4">
                      <OrganizationAvatar
                        name={organization.name}
                        suspended={isSuspended}
                        className="w-10 h-10 rounded-lg text-sm"
                      />

                      <div className="flex-1 min-w-0">
                        <div
                          className={cn(
                            "font-semibold text-sm truncate",
                            isSuspended ? "text-muted-foreground" : "text-foreground",
                          )}
                        >
                          {organization.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                              getRoleBadgeClasses(organization.role),
                            )}
                          >
                            {getRoleLabel(organization.role)}
                          </span>
                          {isSuspended && (
                            <Badge variant="outline" className="px-2 text-muted-foreground">
                              Suspended
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        {isSuspended ? null : isSelecting ? (
                          <CircleNotch
                            className="h-5 w-5 text-primary"
                            style={{
                              animation: "org-spinner 0.8s linear infinite",
                            }}
                            weight="bold"
                          />
                        ) : isCurrent ? (
                          <Check className="h-5 w-5 text-primary" weight="bold" />
                        ) : (
                          <ArrowRight className="h-5 w-5 text-muted-foreground/0 group-hover:text-muted-foreground transition-all duration-200 -translate-x-1 group-hover:translate-x-0" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <p
            className="mt-8 text-center text-xs text-subtle-foreground opacity-0"
            style={{ animation: "org-slide-up 0.5s ease-out 0.6s forwards" }}
          >
            Signed in as {user?.fullName || user?.username || user?.email}
          </p>
        </div>
      </div>
    </>
  );
}
