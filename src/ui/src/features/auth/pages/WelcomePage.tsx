import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Buildings,
  CircleNotch,
  PlusCircle,
  ShieldWarning,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { CreateOrganizationDialog } from "@/features/auth/components/CreateOrganizationDialog";
import { OrganizationList } from "@/features/auth/components/OrganizationList";
import { PendingInvitations } from "@/features/auth/components/PendingInvitations";
import { useSignOut } from "@/features/auth/hooks/useSignOut";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import {
  selectCanCreateOrganization,
  selectOrganizations,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import { fetchMyOrganizations } from "@/features/auth/store/organizationsThunks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

function slideUp(delaySeconds: number, durationSeconds = 0.5) {
  return { animation: `welcome-slide-up ${durationSeconds}s ease-out ${delaySeconds}s forwards` };
}

export function WelcomePage() {
  useDocumentTitle("Welcome");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const user = useAppSelector((state) => state.auth?.user);
  const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);
  const organizations = useAppSelector(selectOrganizations);
  const status = useAppSelector(selectOrganizationsStatus);
  const canCreateOrganization = useAppSelector(selectCanCreateOrganization);
  const switchingSlug = useAppSelector((state) => state.organizations.switchingSlug);
  const handleLogout = useSignOut();
  const { requestSwitch, confirmDialog } = useSwitchOrganization();
  const [confirmingUnsynced, setConfirmingUnsynced] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isAuthenticated) void dispatch(fetchMyOrganizations());
  }, [dispatch, isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  const hasOrganizations = organizations.length > 0;
  const isLoading = !hasOrganizations && (status === "idle" || status === "loading");
  const loadFailed = !hasOrganizations && status === "error";
  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const greetingName = firstName || user?.email || "";

  return (
    <>
      <style>{`
        @keyframes welcome-slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
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

      {creating && <CreateOrganizationDialog onClose={() => setCreating(false)} />}

      <div className="flex min-h-dvh items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-md">
          <div
            className="flex items-center justify-between gap-3 mb-8 opacity-0"
            style={slideUp(0.1)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <UniffyLogo className="w-14 h-14 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg font-bold tracking-tight text-foreground truncate">
                  Welcome, {greetingName}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {hasOrganizations
                    ? "Pick an organization to continue."
                    : isLoading || loadFailed
                      ? user?.email
                      : "You are not in an organization yet."}
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
              className="shrink-0 gap-1.5 text-muted-foreground"
            >
              <SignOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>

          {isLoading ? (
            <div
              className="flex flex-col items-center justify-center py-16 opacity-0"
              style={slideUp(0.2)}
            >
              <CircleNotch className="h-8 w-8 text-primary mb-4 animate-spin" weight="bold" />
              <p className="text-sm text-muted-foreground">Loading organizations...</p>
            </div>
          ) : loadFailed ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
              style={slideUp(0, 0.3)}
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
          ) : (
            <div className="space-y-4">
              <PendingInvitations />

              {user?.isSystemAdmin && (
                <button
                  type="button"
                  onClick={() => navigate("/platform")}
                  className="w-full text-left rounded-xl bg-surface shadow-edge hover:shadow-edge-strong transition-shadow duration-150 group cursor-pointer opacity-0 focus-ring"
                  style={slideUp(0.1, 0.4)}
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
                        Cross-tenant operator view (no organization context)
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground/0 group-hover:text-muted-foreground transition-all duration-200 -translate-x-1 group-hover:translate-x-0" />
                  </div>
                </button>
              )}

              {hasOrganizations && (
                <section className="opacity-0" style={slideUp(0.15, 0.4)}>
                  <h2 className="px-1 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Your organizations
                  </h2>
                  <Card tone="surface" className="p-1.5">
                    <OrganizationList
                      organizations={organizations}
                      currentOrganizationId={currentOrganizationId}
                      switchingSlug={switchingSlug}
                      onSelect={(slug) => void requestSwitch(slug)}
                    />
                  </Card>
                </section>
              )}

              {canCreateOrganization ? (
                <Card tone="surface" className="p-5 opacity-0" style={slideUp(0.25)}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <PlusCircle className="h-5 w-5 text-primary" weight="duotone" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground">
                        Create an organization
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Start a workspace for your team. You become its owner.
                      </p>
                      <Button
                        className="mt-4"
                        onClick={() => setCreating(true)}
                        disabled={switchingSlug !== null}
                        data-testid="welcome-create-organization"
                      >
                        Create organization
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                !hasOrganizations && (
                  <Card tone="surface" className="p-10 text-center opacity-0" style={slideUp(0.2)}>
                    <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                      <Buildings className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-foreground font-medium mb-1">No organizations yet</p>
                    <p className="text-sm text-muted-foreground">
                      Ask an organization admin to invite you.
                    </p>
                  </Card>
                )
              )}
            </div>
          )}

          <p
            className="mt-8 text-center text-xs text-subtle-foreground opacity-0"
            style={slideUp(0.6)}
          >
            Signed in as {user?.email || user?.username}
          </p>
        </div>
      </div>
    </>
  );
}
