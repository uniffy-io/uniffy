import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { useNavigate } from 'react-router-dom';
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { MyOrganization } from "@uniffy/proto/organizations/v1/organizations_pb";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCredentials, logout } from "@/features/auth/store/authSlice";
import { cancelRecording } from "@/features/recording";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { resetSettings } from "@/features/settings/store/settingsSlice";
import { clearNotes } from "@/features/notes/store/notesSlice";
import { clearTree as clearNotesTree } from "@/features/notes/store/notesTreeSlice";
import { clearBookmarks } from "@/features/bookmarks";
import { clearPresence } from "@/features/presence";
import { clearPermissions } from "@/features/permissions";
import { clearAdmin } from "@/features/admin";
import {
    clearBlobCache,
    clearFiles,
    clearTree as clearFilesTree,
    clearUploads,
    closeViewer,
    clearSavedFilters,
} from "@/features/files";
import { clearChatChannels, clearChatMessages, clearChatThreads, clearChatUi } from '@/features/chat/store';
import { clearTags } from '@/features/tags/store/tagsSlice';
import { setAccentColor, setFontFamily } from "@/config/theme/themeSlice";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { unaryTransport, setMemoryAccessToken, clearMemoryAccessToken } from "@/config";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import {
  Buildings,
  SignOut,
  ArrowRight,
  Plus,
  CircleNotch,
} from "@phosphor-icons/react";

/**
 * Get human-readable label for organization role.
 */
function getRoleLabel(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return 'owner';
    case OrganizationRole.ADMIN:
      return 'admin';
    case OrganizationRole.MEMBER:
      return 'member';
    default:
      return 'member';
  }
}

/**
 * Role badge color mapping.
 */
function getRoleBadgeClasses(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return 'bg-primary/10 text-primary';
    case OrganizationRole.ADMIN:
      return 'bg-primary/10 text-primary';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/**
 * Extract initials from an organization name for the avatar.
 */
function getOrgInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function OrganizationPicker() {
  useDocumentTitle('Select Organization');
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectingSlug, setSelectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth?.accessToken);
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const user = useAppSelector((state) => state.auth?.user);
  const recordingState = useAppSelector((state) => state.recording.state);
  const [pendingOrgSlug, setPendingOrgSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth');
      return;
    }

    const fetchOrgs = async () => {
      try {
        const client = createClient(OrganizationsService, unaryTransport);
        const response = await client.listMyOrganizations(
          {},
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        setOrganizations(response.organizations);
      } catch {
        setError('Failed to load organizations.');
      } finally {
        setLoading(false);
      }
    };

    fetchOrgs();
  }, [accessToken, navigate]);

  const RECORDING_ACTIVE_STATES = new Set([
    'requesting', 'initiating-upload', 'recording', 'paused',
    'stopping', 'flushing', 'completing',
  ]);

  const handleSelectOrg = async (orgSlug: string) => {
    if (!refreshToken) {
      setError("Session expired. Please login again.");
      return;
    }
    // A live recording is owned by the current org's MultipartUpload
    // row. Switching orgs would orphan the upload (server-side reaper
    // handles it eventually, but the user loses the clip). Confirm
    // before discarding.
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
      // Refresh token with the selected organization slug to get an org-scoped token
      const response = await client.refreshToken({
        refreshToken,
        organizationSlug: orgSlug,
      });

      // Store access token in memory (security: not persisted to localStorage)
      setMemoryAccessToken(response.accessToken);

      // Update credentials with new token and organization ID
      // We assume user info is same, but we update tokens
      if (user) {
        // Sync theme preferences from user profile
        if (user.accentColor) {
          dispatch(setAccentColor(user.accentColor));
        }
        if (user.fontFamily) {
          dispatch(setFontFamily(user.fontFamily));
        }

        dispatch(setCredentials({
          user: user, // Keep existing user info
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          organizationId: response.organizationId,
          organizationRole: response.organizationRole,
          sessionId: response.sessionId,
          domainAdminDomains: Array.from(response.domainAdminDomains),
        }));
      }

      navigate('/');
    } catch {
      setError('Failed to switch to organization.');
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

  const handleLogout = () => {
    // Clear memory access token (security: remove from memory)
    clearMemoryAccessToken();
    // Clear all user/org-specific state
    dispatch(logout());
    dispatch(resetSettings());
    // Clear notes state
    dispatch(clearNotes());
    dispatch(clearNotesTree());
    // Clear files state
    dispatch(clearFiles());
    dispatch(clearFilesTree());
    dispatch(clearUploads());
    dispatch(closeViewer());
    dispatch(clearSavedFilters());
    // Clear other state
    dispatch(clearBookmarks());
    dispatch(clearPresence());
    dispatch(clearPermissions());
    dispatch(clearAdmin());
    dispatch(clearChatChannels());
    dispatch(clearChatMessages());
    dispatch(clearChatThreads());
    dispatch(clearChatUi());
    dispatch(clearTags());
    // Clear file blob cache
    clearBlobCache();
    // Navigate to auth page
    navigate('/auth');
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
          {/* Header area */}
          <div
            className="flex items-center justify-between mb-8 opacity-0"
            style={{ animation: 'org-slide-up 0.5s ease-out 0.1s forwards' }}
          >
            <div className="flex items-center gap-3">
              <UniffyLogo className="w-14 h-14" />
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground">
                  Select a workspace
                </h1>
                <p className="text-xs text-muted-foreground">
                  {user?.email || 'Choose where to continue'}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5 text-muted-foreground">
              <SignOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
              style={{ animation: 'org-slide-up 0.3s ease-out forwards' }}
            >
              <svg className="h-4 w-4 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM8 12a1 1 0 100-2 1 1 0 000 2z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Loading state */}
          {loading ? (
            <div
              className="flex flex-col items-center justify-center py-16 opacity-0"
              style={{ animation: 'org-slide-up 0.5s ease-out 0.2s forwards' }}
            >
              <CircleNotch
                className="h-8 w-8 text-primary mb-4"
                style={{ animation: 'org-spinner 0.8s linear infinite' }}
                weight="bold"
              />
              <p className="text-sm text-muted-foreground">Loading workspaces...</p>
            </div>
          ) : organizations.length === 0 ? (
            /* Empty state */
            <div
              className="rounded-xl border border-border bg-card p-10 text-center opacity-0"
              style={{ animation: 'org-slide-up 0.5s ease-out 0.2s forwards' }}
            >
              <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <Buildings className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-foreground font-medium mb-1">No workspaces yet</p>
              <p className="text-sm text-muted-foreground mb-6">
                You are not a member of any organization.
              </p>
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Create New Organization
              </Button>
            </div>
          ) : (
            /* Organization list */
            <div className="space-y-2">
              {organizations.map((myOrg, index) => {
                const slug = myOrg.organization?.slug || '';
                const isSelecting = selectingSlug === slug;

                return (
                  <button
                    key={myOrg.organization?.id}
                    onClick={() => handleSelectOrg(slug)}
                    disabled={selectingSlug !== null}
                    className={`
                      w-full text-left rounded-xl border bg-card
                      transition-all duration-200 group cursor-pointer
                      opacity-0
                      ${isSelecting
                        ? 'border-primary ring-2 ring-primary/20 shadow-sm'
                        : 'border-border hover:border-muted-foreground/30 hover:shadow-sm'
                      }
                      ${selectingSlug !== null && !isSelecting ? 'opacity-60' : ''}
                    `}
                    style={{
                      animation: `org-slide-up 0.4s ease-out ${0.15 + index * 0.06}s forwards`,
                    }}
                  >
                    <div className="flex items-center gap-4 p-4">
                      {/* Org avatar */}
                      <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary font-bold text-sm">
                          {getOrgInitials(myOrg.organization?.name || '?')}
                        </span>
                      </div>

                      {/* Org info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-foreground truncate">
                          {myOrg.organization?.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded capitalize ${getRoleBadgeClasses(myOrg.role)}`}
                          >
                            {getRoleLabel(myOrg.role)}
                          </span>
                        </div>
                      </div>

                      {/* Arrow / spinner */}
                      <div className="flex-shrink-0">
                        {isSelecting ? (
                          <CircleNotch
                            className="h-5 w-5 text-primary"
                            style={{ animation: 'org-spinner 0.8s linear infinite' }}
                            weight="bold"
                          />
                        ) : (
                          <ArrowRight
                            className="h-5 w-5 text-muted-foreground/0 group-hover:text-muted-foreground transition-all duration-200 -translate-x-1 group-hover:translate-x-0"
                          />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <p
            className="mt-8 text-center text-xs text-muted-foreground/60 opacity-0"
            style={{ animation: 'org-slide-up 0.5s ease-out 0.6s forwards' }}
          >
            Signed in as {user?.fullName || user?.username || user?.email}
          </p>
        </div>
      </div>
    </>
  );
}
