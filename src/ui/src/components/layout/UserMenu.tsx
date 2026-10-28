import { useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  Books,
  SignOut,
  Moon,
  ShieldCheck,
  ShieldWarning,
  Smiley,
  Sun,
  Desktop,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { OrganizationList } from "@/features/auth/components/OrganizationList";
import {
  pendingOrganizationNames,
  usePendingOrganizations,
  useSignOut,
  type PendingOrganization,
} from "@/features/auth/hooks/useSignOut";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import { selectPendingInvitationCount } from "@/features/auth/store/invitationsSlice";
import { refreshMyInvitationsQuietly } from "@/features/auth/store/invitationsThunks";
import { selectOrganizations } from "@/features/auth/store/organizationsSlice";
import { reloadOrganizationsAndRole } from "@/features/auth/store/organizationsThunks";
import { useCustomStatus } from "@/features/presence/hooks/useCustomStatus";
import { CustomStatusPicker } from "@/features/presence/components/CustomStatusPicker";
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";
import { fetchProfilePolicyThunk } from "@/features/people/store/peopleThunks";
import { useTheme } from "@/config/theme/themeContext";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";
import { avatarUrlAtVariant } from "@/shared/utils/fileUrls";
import { getInitials } from "@/components/subject/utils";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface UnsyncedEditsMessageProps {
  pending: PendingOrganization[];
  currentOrganizationId: string | null;
  onSwitch: (slug: string) => void;
}

/** Names where the unsynced edits sit and offers to go to each organization that can still save them. */
function UnsyncedEditsMessage({
  pending,
  currentOrganizationId,
  onSwitch,
}: UnsyncedEditsMessageProps) {
  if (pending.length === 0) {
    return <>Some edits have not reached the server yet. Signing out now discards them.</>;
  }
  const reachable = pending.flatMap(({ id, organization }) =>
    organization && id !== currentOrganizationId && !organization.suspended ? [organization] : [],
  );
  return (
    <div className="space-y-3">
      <p>
        Edits in {pendingOrganizationNames(pending)} have not reached the server yet. Signing out
        now discards them.
      </p>
      {reachable.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          {reachable.map((organization) => (
            <Button
              key={organization.id}
              type="button"
              variant="secondary"
              className="max-w-full"
              onClick={() => onSwitch(organization.slug)}
            >
              <span className="truncate">Switch to {organization.name} to finish saving</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserMenu() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const signOut = useSignOut();
  const listPendingOrganizations = usePendingOrganizations();
  const recordingState = useAppSelector((state) => state.recording.state);
  const { canAccessAdmin, isSystemAdmin } = useAdminAccess();
  const { themeMode, setTheme, availableModes } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  // The organizations holding unsynced edits while the sign-out waits for a decision.
  const [unsynced, setUnsynced] = useState<PendingOrganization[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentCustomStatus = useCustomStatus(user?.id ?? "");
  const orgChartEnabled = useAppSelector((state) => state.people.policy.orgChartEnabled);
  const peoplePolicyStatus = useAppSelector((state) => state.people.policy.status);
  const organizations = useAppSelector(selectOrganizations);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const switchingSlug = useAppSelector((state) => state.organizations.switchingSlug);
  const pendingInvitationCount = useAppSelector(selectPendingInvitationCount);
  const { requestSwitch, confirmDialog: switchConfirmDialog } = useSwitchOrganization();

  useEffect(() => {
    if (isOpen && peoplePolicyStatus === "idle") {
      dispatch(fetchProfilePolicyThunk());
    }
  }, [isOpen, peoplePolicyStatus, dispatch]);

  const RECORDING_ACTIVE_STATES = new Set([
    "requesting",
    "initiating-upload",
    "recording",
    "paused",
    "stopping",
    "flushing",
    "completing",
  ]);
  const isRecordingActive = RECORDING_ACTIVE_STATES.has(recordingState);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current && menuRef.current.contains(target)) return;
      // Portal-rendered descendants (Select etc.) live outside the DOM subtree but belong logically.
      const portalEl = (target as Element).closest?.("[data-select-portal]");
      if (portalEl) return;
      setIsOpen(false);
    }

    // Defer to the next tick so the opening click itself doesn't immediately close the menu.
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  if (!user) return null;

  const requestLogout = () => {
    if (isRecordingActive) {
      setConfirmingLogout(true);
      setIsOpen(false);
      return;
    }
    performLogout();
  };

  const performLogout = async () => {
    setConfirmingLogout(false);
    if (!(await signOut())) {
      setIsOpen(false);
      setUnsynced(await listPendingOrganizations());
    }
  };

  // Other sessions and other people change memberships, roles and invitations with no push to this
  // tab, so opening the menu reloads them.
  const toggleMenu = () => {
    if (!isOpen) {
      void dispatch(reloadOrganizationsAndRole());
      void dispatch(refreshMyInvitationsQuietly());
    }
    setIsOpen(!isOpen);
  };

  const selectOrganization = (slug: string) => {
    setIsOpen(false);
    void requestSwitch(slug);
  };

  const displayName = user.fullName || user.username || "User";
  const avatarUrl = user.avatarUrl ? avatarUrlAtVariant(user.avatarUrl, "lg") : "";

  const themeIcons = {
    dark: Moon,
    light: Sun,
    system: Desktop,
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="User menu"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={toggleMenu}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full overflow-hidden",
          "border border-border-nav transition-all duration-150",
          "focus-ring",
          isOpen ? "border-primary/30" : "hover:border-primary/30",
        )}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span
            className={cn(
              "flex items-center justify-center w-full h-full text-[10px] font-bold tracking-tight",
              "bg-primary text-primary-foreground",
            )}
          >
            {user.fullName
              ? getInitials(user.fullName)
              : (user.username || "??").slice(0, 2).toUpperCase()}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className={cn(
            popoverShellClass,
            "absolute right-0 z-100 mt-1.5 w-[min(240px,calc(100vw-2rem))] origin-top-right py-1.5",
            "animate-in fade-in slide-in-from-top-2 duration-200",
          )}
        >
          <div className="px-3 py-2.5 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden",
                  !avatarUrl && "bg-primary text-primary-foreground text-sm font-semibold",
                )}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover rounded-lg" />
                ) : user.fullName ? (
                  getInitials(user.fullName)
                ) : (
                  (user.username || "??").slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>

          <div className="border-b border-border py-1.5 px-1.5">
            <div className="flex items-center justify-between gap-2 pl-2.5 pr-1.5">
              <span className="py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Organizations
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  navigate("/welcome");
                }}
                className="group/all flex min-h-11 md:min-h-0 items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors focus-ring"
              >
                {pendingInvitationCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                    {pendingInvitationCount > 99 ? "99+" : pendingInvitationCount}
                    <span className="sr-only"> pending invitations,</span>
                  </span>
                )}
                <span>
                  View all<span className="sr-only"> organizations</span>
                </span>
                <ArrowRight
                  size={10}
                  weight="bold"
                  aria-hidden="true"
                  className="transition-transform duration-200 group-hover/all:translate-x-0.5"
                />
              </button>
            </div>
            {organizations.length > 0 && (
              <div className="max-h-[min(15rem,40dvh)] overflow-y-auto">
                <OrganizationList
                  compact
                  organizations={organizations}
                  currentOrganizationId={currentOrganizationId}
                  switchingSlug={switchingSlug}
                  onSelect={selectOrganization}
                />
              </div>
            )}
          </div>

          <div className="border-b border-border py-1.5 px-1.5">
            {showStatusPicker ? (
              <CustomStatusPicker
                onClose={() => setShowStatusPicker(false)}
                className="border-0 shadow-none p-0 w-full"
              />
            ) : (
              <button
                onClick={() => setShowStatusPicker(true)}
                className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
              >
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                {currentCustomStatus ? (
                  <>
                    <span className="shrink-0">{currentCustomStatus.emoji}</span>
                    <span className="truncate">{currentCustomStatus.text}</span>
                  </>
                ) : (
                  <>
                    <Smiley
                      size={16}
                      weight="duotone"
                      className="text-muted-foreground group-hover:text-primary transition-colors duration-200"
                    />
                    <span>Set a status</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="py-1.5 px-1.5">
            {orgChartEnabled && (
              <button
                onClick={() => {
                  navigate("/people");
                  setIsOpen(false);
                }}
                className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
              >
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                <UsersThree
                  size={16}
                  weight="duotone"
                  className="text-muted-foreground group-hover:text-primary transition-colors duration-200"
                />
                <span>People</span>
              </button>
            )}

            <button
              onClick={() => {
                navigate("/library");
                setIsOpen(false);
              }}
              className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
            >
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
              <Books
                size={16}
                weight="duotone"
                className="text-muted-foreground group-hover:text-primary transition-colors duration-200"
              />
              <span>Library</span>
            </button>

            <button
              onClick={() => {
                navigate("/settings");
                setIsOpen(false);
              }}
              className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
            >
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
              <UserCircle
                size={16}
                weight="duotone"
                className="text-muted-foreground group-hover:text-primary transition-colors duration-200"
              />
              <span>Settings</span>
            </button>

            {canAccessAdmin && (
              <button
                onClick={() => {
                  navigate("/admin");
                  setIsOpen(false);
                }}
                className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
              >
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                <ShieldCheck
                  size={16}
                  weight="duotone"
                  className="text-muted-foreground group-hover:text-primary transition-colors duration-200"
                />
                <span>Administration</span>
              </button>
            )}

            {isSystemAdmin && (
              <button
                onClick={() => {
                  navigate("/platform");
                  setIsOpen(false);
                }}
                className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
              >
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-amber-500 transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                <ShieldWarning
                  size={16}
                  weight="duotone"
                  className="text-amber-600 dark:text-amber-400 group-hover:text-amber-500 transition-colors duration-200"
                />
                <span>Platform admin</span>
              </button>
            )}
          </div>

          <div className="border-t border-border py-1.5 px-1.5">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Appearance
            </div>
            <div className="flex gap-1 px-1.5">
              {availableModes.map((mode) => {
                const Icon = themeIcons[mode as keyof typeof themeIcons] || Desktop;
                const isSelected = themeMode === mode;

                return (
                  <button
                    key={mode}
                    onClick={() => setTheme(mode)}
                    className={cn(
                      "group relative flex-1 flex flex-col items-center gap-1 py-2 px-1.5 rounded-md transition-all duration-200 overflow-hidden",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-300 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
                    <Icon
                      size={14}
                      weight={isSelected ? "fill" : "duotone"}
                      className={cn(
                        "transition-colors duration-200",
                        !isSelected && "group-hover:text-primary",
                      )}
                    />
                    <span className="text-[10px] font-medium capitalize">{mode}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border pt-1.5 px-1.5">
            <button
              onClick={requestLogout}
              className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md transition-colors overflow-hidden"
              style={{ color: "var(--status-error)" }}
            >
              <span
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70"
                style={{ backgroundColor: "var(--status-error)" }}
              />
              <SignOut size={16} weight="duotone" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingLogout}
        onClose={() => setConfirmingLogout(false)}
        onConfirm={performLogout}
        title="Stop recording and sign out?"
        message="A screen recording is in progress. Signing out will discard it."
        confirmLabel="Discard and sign out"
        cancelLabel="Stay"
        variant="warning"
      />
      <ConfirmDialog
        isOpen={unsynced !== null}
        onClose={() => setUnsynced(null)}
        onConfirm={() => {
          setUnsynced(null);
          void signOut({ discardUnsynced: true });
        }}
        title="Discard unsynced edits?"
        message={
          <UnsyncedEditsMessage
            pending={unsynced ?? []}
            currentOrganizationId={currentOrganizationId}
            onSwitch={(slug) => {
              setUnsynced(null);
              void requestSwitch(slug);
            }}
          />
        }
        confirmLabel="Discard and sign out"
        cancelLabel="Stay"
        variant="warning"
      />
      {switchConfirmDialog}
    </div>
  );
}
