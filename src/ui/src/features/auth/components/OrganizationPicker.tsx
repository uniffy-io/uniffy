import { useState, useEffect } from "react";
import { createClient } from "@connectrpc/connect";
import { useNavigate } from "react-router-dom";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { MyOrganization } from "@uniffy/proto/organizations/v1/organizations_pb";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCredentials } from "@/features/auth/store/authSlice";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { clearSessionCaches, useSignOut } from "@/features/auth/hooks/useSignOut";
import { cancelRecording } from "@/features/recording/store/recordingThunks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setAccentColor, setFontFamily } from "@/config/theme/themeSlice";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { Card } from "@/components/ui/card";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import { cn } from "@/shared/utils/cn";
import { unaryTransport, setMemoryAccessToken } from "@/config";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import {
  Buildings,
  SignOut,
  ArrowRight,
  Plus,
  CircleNotch,
  ShieldWarning,
  WarningCircle,
} from "@phosphor-icons/react";

function getRoleLabel(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return "Owner";
    case OrganizationRole.ADMIN:
      return "Admin";
    case OrganizationRole.MEMBER:
      return "Member";
    default:
      return "Member";
  }
}

function getRoleBadgeClasses(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return "bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300";
    case OrganizationRole.ADMIN:
      return "bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 dark:from-blue-950 dark:to-blue-900 dark:text-blue-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function OrganizationPicker() {
  useDocumentTitle("Select Organization");
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectingSlug, setSelectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth?.accessToken);
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const handleLogout = useSignOut();
  const user = useAppSelector((state) => state.auth?.user);
  const recordingState = useAppSelector((state) => state.recording.state);
  const [pendingOrgSlug, setPendingOrgSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      navigate("/auth");
      return;
    }

    const fetchOrgs = async () => {
      try {
        const client = createClient(OrganizationsService, unaryTransport);
        const response = await client.listMyOrganizations(
          {},
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        setOrganizations(response.organizations);
      } catch {
        setError("Failed to load organizations.");
      } finally {
        setLoading(false);
      }
    };

    fetchOrgs();
  }, [accessToken, navigate]);

  const RECORDING_ACTIVE_STATES = new Set([
    "requesting",
    "initiating-upload",
    "recording",
    "paused",
    "stopping",
    "flushing",
    "completing",
  ]);

  const handleSelectOrg = async (orgSlug: string) => {
    if (!refreshToken) {
      setError("Session expired. Please login again.");
      return;
    }
    // Switching orgs orphans the MultipartUpload row that backs an active recording, losing the clip.
    if (RECORDING_ACTIVE_STATES.has(recordingState)) {
      setPendingOrgSlug(orgSlug);
      return;
    }
    await switchToOrg(orgSlug);
  };

  const switchToOrg = async (orgSlug: string) => {
    if (!refreshToken) {
      setError("Session expired. Please login again.");
      return;
    }
    setSelectingSlug(orgSlug);
    try {
      const client = createClient(AuthService, unaryTransport);
      const response = await client.switchOrganization({
        refreshToken,
        organizationSlug: orgSlug,
      });
      const r = response.authResult;
      if (!r) {
        setError("Failed to switch to organization.");
        setSelectingSlug(null);
        return;
      }

      clearSessionCaches(dispatch);
      dispatch(resetOrganizationScope());
      setMemoryAccessToken(r.accessToken);

      if (user) {
        if (user.accentColor) {
          dispatch(setAccentColor(user.accentColor));
        }
        if (user.fontFamily) {
          dispatch(setFontFamily(user.fontFamily));
        }

        dispatch(
          setCredentials({
            user: user,
            accessToken: r.accessToken,
            refreshToken: r.refreshToken,
            organizationId: r.organizationId,
            organizationSlug: r.organizationSlug || orgSlug,
            organizationRole: r.organizationRole,
            sessionId: r.sessionId,
            domainAdminDomains: Array.from(r.domainAdminDomains),
          }),
        );
      }

      navigate("/");
    } catch {
      setError("Failed to switch to organization.");
      setSelectingSlug(null);
    }
  };

  const confirmDiscardAndSwitch = async () => {
    if (!pendingOrgSlug) return;
    const slug = pendingOrgSlug;
    setPendingOrgSlug(null);
    await dispatch(cancelRecording());
    await switchToOrg(slug);
  };

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

      <ConfirmDialog
        isOpen={pendingOrgSlug !== null}
        onClose={() => setPendingOrgSlug(null)}
        onConfirm={() => void confirmDiscardAndSwitch()}
        title="Discard active recording?"
        message="A screen recording is in progress. Switching organizations will discard it."
        confirmLabel="Discard and switch"
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
                  Select a workspace
                </h1>
                <p className="text-xs text-muted-foreground">
                  {user?.email || "Choose where to continue"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-1.5 text-muted-foreground"
            >
              <SignOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>

          {error && (
            <div
              className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
              style={{ animation: "org-slide-up 0.3s ease-out forwards" }}
            >
              <WarningCircle className="h-4 w-4 mt-0.5 flex-shrink-0" weight="fill" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div
              className="flex flex-col items-center justify-center py-16 opacity-0"
              style={{ animation: "org-slide-up 0.5s ease-out 0.2s forwards" }}
            >
              <CircleNotch
                className="h-8 w-8 text-primary mb-4"
                style={{ animation: "org-spinner 0.8s linear infinite" }}
                weight="bold"
              />
              <p className="text-sm text-muted-foreground">Loading workspaces...</p>
            </div>
          ) : organizations.length === 0 ? (
            <Card
              tone="surface"
              className="p-10 text-center opacity-0"
              style={{ animation: "org-slide-up 0.5s ease-out 0.2s forwards" }}
            >
              <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <Buildings className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-foreground font-medium mb-1">No workspaces yet</p>
              <p className="text-sm text-muted-foreground mb-6">
                {user?.isSystemAdmin
                  ? "You are a platform operator with no tenant membership. Open the platform console to manage the deployment."
                  : "You are not a member of any organization."}
              </p>
              {user?.isSystemAdmin ? (
                <div className="flex flex-col gap-2">
                  <Button variant="default" className="gap-2" onClick={() => navigate("/platform")}>
                    <ShieldWarning className="h-4 w-4" weight="duotone" />
                    Open platform console
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create New Organization
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create New Organization
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
              {organizations.map((myOrg, index) => {
                const slug = myOrg.organization?.slug || "";
                const isSelecting = selectingSlug === slug;

                return (
                  <button
                    key={myOrg.organization?.id}
                    onClick={() => handleSelectOrg(slug)}
                    disabled={selectingSlug !== null}
                    className={cn(
                      "w-full text-left rounded-xl transition-shadow duration-150 group cursor-pointer opacity-0",
                      isSelecting
                        ? "bg-primary/5 shadow-edge-primary"
                        : "bg-surface shadow-edge hover:shadow-edge-strong",
                      selectingSlug !== null && !isSelecting && "opacity-60",
                    )}
                    style={{
                      animation: `org-slide-up 0.4s ease-out ${0.15 + index * 0.06}s forwards`,
                    }}
                  >
                    <div className="flex items-center gap-4 p-4">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white font-semibold text-sm"
                        style={getAvatarGradientStyle(myOrg.organization?.name || "?")}
                      >
                        {getInitials(myOrg.organization?.name || "?")}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-foreground truncate">
                          {myOrg.organization?.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                              getRoleBadgeClasses(myOrg.role),
                            )}
                          >
                            {getRoleLabel(myOrg.role)}
                          </span>
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        {isSelecting ? (
                          <CircleNotch
                            className="h-5 w-5 text-primary"
                            style={{
                              animation: "org-spinner 0.8s linear infinite",
                            }}
                            weight="bold"
                          />
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
