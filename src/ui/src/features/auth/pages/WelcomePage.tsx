import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Buildings,
  CircleNotch,
  Plus,
  ShieldWarning,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { preloadDashboard } from "@/app/mainRouteLoaders";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { enterThroughPortal } from "@/components/orbit/launch/launchCurtain";
import { OrbitPage } from "@/components/orbit/OrbitPage";
import { stagger } from "@/components/orbit/stagger";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { CreateOrganizationDialog } from "@/features/auth/components/CreateOrganizationDialog";
import { OrganizationList } from "@/features/auth/components/OrganizationList";
import { PendingInvitations } from "@/features/auth/components/PendingInvitations";
import { useSignOut } from "@/features/auth/hooks/useSignOut";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import { selectInvitationActingId } from "@/features/auth/store/invitationsSlice";
import {
  selectCanCreateOrganization,
  selectOrganizations,
  selectOrganizationsSettled,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import {
  fetchMyOrganizations,
  refreshMyOrganizationsQuietly,
} from "@/features/auth/store/organizationsThunks";
import { buildWelcomeScene } from "@/features/auth/welcomeScene";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useRefreshOnReturn } from "@/shared/hooks/useRefreshOnReturn";
import { cn } from "@/shared/utils/cn";

export function WelcomePage() {
  useDocumentTitle("Welcome");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const user = useAppSelector((state) => state.auth?.user);
  const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);
  const organizations = useAppSelector(selectOrganizations);
  const status = useAppSelector(selectOrganizationsStatus);
  const settled = useAppSelector(selectOrganizationsSettled);
  const canCreateOrganization = useAppSelector(selectCanCreateOrganization);
  const switchingSlug = useAppSelector((state) => state.organizations.switchingSlug);
  const invitationActingId = useAppSelector(selectInvitationActingId);
  const handleLogout = useSignOut();
  const { requestSwitch, confirmDialog } = useSwitchOrganization();
  const [confirmingUnsynced, setConfirmingUnsynced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const orbitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) void dispatch(fetchMyOrganizations());
  }, [dispatch, isAuthenticated]);
  const reloadOrganizations = useCallback(
    () => void dispatch(refreshMyOrganizationsQuietly()),
    [dispatch],
  );
  useRefreshOnReturn(reloadOrganizations, isAuthenticated);

  const scene = useMemo(
    () =>
      buildWelcomeScene({
        organizations,
        currentOrganizationId: currentOrganizationId ?? null,
        highlighted,
        launching,
      }),
    [organizations, currentOrganizationId, highlighted, launching],
  );

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  const hasOrganizations = organizations.length > 0;
  // Only the first load shows the spinner; a reload keeps what the last settled load showed.
  const isLoading = !hasOrganizations && settled === null;
  const loadFailed = !hasOrganizations && settled === "error";
  // An accept switches this tab too, so no other switch starts while an invitation action runs.
  const busy = switchingSlug !== null || invitationActingId !== null || launching;
  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const greetingName = firstName || user?.email?.split("@")[0] || "";

  // The tab is already in the organization when this runs; the portal opens on the way in.
  const stepInto = (slug: string) => {
    preloadDashboard();
    void requestSwitch(slug, undefined, async () => {
      setLaunching(true);
      await enterThroughPortal(orbitRef.current);
    });
  };

  const lede = hasOrganizations
    ? null
    : isLoading || loadFailed
      ? "One moment while we find your workspaces."
      : canCreateOrganization
        ? "You are not in an organization yet. Start one, or wait here for an invitation."
        : "You are not in an organization yet. Ask an admin to invite this email address.";

  const title = stagger(0);
  const ledeEnter = stagger(1);
  const body = stagger(2);
  const footer = stagger(5);

  return (
    <>
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

      <OrbitPage
        scene={scene}
        orbitRef={orbitRef}
        orbitCaption={hasOrganizations ? "Your organizations" : undefined}
        launching={launching}
        header={
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <UniffyLogo className="h-6 w-6" />
              <span className="text-sm font-semibold text-foreground">Uniffy</span>
            </div>
            {user?.isSystemAdmin && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => navigate("/platform")}
                title="Cross tenant operator view, outside any organization"
              >
                <ShieldWarning size={15} className="text-amber-700 dark:text-amber-300" />
                Platform console
              </Button>
            )}
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                void handleLogout().then((signedOut) => {
                  if (!signedOut) setConfirmingUnsynced(true);
                });
              }}
              className="text-muted-foreground"
            >
              <SignOut size={15} />
              Sign out
            </Button>
          </>
        }
      >
        <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-8 md:px-8 lg:mx-0 lg:max-w-2xl lg:px-12 lg:py-12 xl:pl-20">
          <h1
            className={cn(
              "text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl",
              title.className,
            )}
            style={title.style}
          >
            {hasOrganizations ? "Welcome back" : "Welcome"},{" "}
            <span className="text-primary">{greetingName}</span>.
          </h1>
          {lede && (
            <p
              className={cn(
                "mt-3 max-w-[34rem] text-[15px] leading-relaxed text-muted-foreground",
                ledeEnter.className,
              )}
              style={ledeEnter.style}
            >
              {lede}
            </p>
          )}

          <div className={cn("mt-8 space-y-7", body.className)} style={body.style}>
            {isLoading ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <CircleNotch size={16} weight="bold" className="animate-spin text-primary" />
                Loading organizations
              </div>
            ) : loadFailed ? (
              <div className="flex items-center gap-3 rounded-xl bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <WarningCircle size={16} weight="fill" className="shrink-0" />
                <span className="flex-1">Your organizations could not be loaded.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={status === "loading"}
                  onClick={() => void dispatch(fetchMyOrganizations())}
                  className="-my-1"
                >
                  Retry
                </Button>
              </div>
            ) : (
              <>
                <PendingInvitations />

                {hasOrganizations && (
                  <section aria-labelledby="welcome-organizations" className="space-y-2">
                    <h2
                      id="welcome-organizations"
                      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Your organizations
                    </h2>
                    <OrganizationList
                      organizations={organizations}
                      currentOrganizationId={currentOrganizationId}
                      switchingSlug={switchingSlug}
                      disabled={busy}
                      onSelect={stepInto}
                      onHighlight={setHighlighted}
                    />
                  </section>
                )}

                {canCreateOrganization ? (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    disabled={busy}
                    className="focus-ring group flex w-full items-center gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
                    data-testid="welcome-create-organization"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/55 bg-primary/10 text-primary">
                      <Plus size={16} weight="bold" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        Create an organization
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Start a workspace for your team. You become its owner.
                      </span>
                    </span>
                    <ArrowRight
                      size={16}
                      className="-translate-x-1 text-subtle-foreground transition-all duration-200 group-hover:translate-x-0 group-hover:text-foreground"
                    />
                  </button>
                ) : (
                  !hasOrganizations && (
                    <div className="flex items-center gap-3 rounded-xl bg-surface p-4 shadow-edge">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Buildings size={18} />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        Invitations land here as soon as an admin sends one.
                      </span>
                    </div>
                  )
                )}
              </>
            )}
          </div>

          <p
            className={cn("mt-8 text-xs text-subtle-foreground", footer.className)}
            style={footer.style}
          >
            Signed in as {user?.email || user?.username}
          </p>
        </div>
      </OrbitPage>
    </>
  );
}
