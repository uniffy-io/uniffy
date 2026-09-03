import { useState, useEffect, useRef } from "react";
import {
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
import { logout } from "@/features/auth/store/authSlice";
import { resetSettings } from "@/features/settings/store/settingsSlice";
import { clearNotes } from "@/features/notes/store/notesSlice";
import { clearTree } from "@/features/notes/store/notesTreeSlice";
import { clearAllCache as clearNotesCache } from "@/features/notes/utils/notesCache";
import { clearLibraryScope } from "@/features/library/store/clearLibraryScope";
import { clearNotifications } from "@/features/notifications/store/notificationsSlice";
import { cancelRecording } from "@/features/recording/store/recordingThunks";
import { clearPresence } from "@/features/presence/store/presenceSlice";
import { useCustomStatus } from "@/features/presence/hooks/useCustomStatus";
import { CustomStatusPicker } from "@/features/presence/components/CustomStatusPicker";
import { clearPermissions } from "@/features/permissions/store/permissionsSlice";
import { clearAdmin } from "@/features/admin/store/adminSlice";
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";
import { clearBlobCache } from "@/features/files/components/viewer/hooks/blobCache";
import { clearComments } from "@/features/comments/store/commentsSlice";
import {
  clearChatChannels,
  clearChatMessages,
  clearChatThreads,
  clearChatUi,
  clearChatDrafts,
} from "@/features/chat/store";
import { clearAgentMessages } from "@/features/agents/store/agentMessagesSlice";
import { clearAgentMemories } from "@/features/agents/store/agentMemoriesSlice";
import { clearAgentProviders } from "@/features/agents/store/agentProvidersSlice";
import { clearAgentRuntimeSettings } from "@/features/admin/store/agentRuntimeSettingsSlice";
import { clearIntegrations } from "@/features/integrations/store/integrationsSlice";
import { clearTags } from "@/features/tags/store/tagsSlice";
import { clearPeople } from "@/features/people/store/peopleSlice";
import { fetchProfilePolicyThunk } from "@/features/people/store/peopleThunks";
import { clearCalls } from "@/features/calls/store/callsSlice";
import { clearRooms } from "@/features/rooms/store/roomsSlice";
import { resetCalendarState, resetCalendarUiState } from "@/features/calendar/store";
import { clearMemoryAccessToken } from "@/config/api";
import { teardownStorageEncryption } from "@/shared/crypto/storageEncryption";
import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import { useTheme } from "@/config/theme/ThemeProvider";
import { cn } from "@/shared/utils/cn";
import { avatarUrlAtVariant } from "@/shared/utils/fileUrls";
import { getInitials } from "@/components/subject/utils";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function UserMenu() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, refreshToken } = useAppSelector((state) => state.auth);
  const recordingState = useAppSelector((state) => state.recording.state);
  const { canAccessAdmin, isSystemAdmin } = useAdminAccess();
  const { themeMode, setTheme, availableModes } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentCustomStatus = useCustomStatus(user?.id ?? "");
  const orgChartEnabled = useAppSelector((state) => state.people.policy.orgChartEnabled);
  const peoplePolicyStatus = useAppSelector((state) => state.people.policy.status);

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

  const performLogout = () => {
    setConfirmingLogout(false);
    handleLogout();
  };

  const handleLogout = () => {
    void dispatch(cancelRecording());
    if (refreshToken) {
      const client = createClient(AuthService, unaryTransport);
      client.logout({ refreshToken }).catch(() => {});
    }
    clearMemoryAccessToken();
    teardownStorageEncryption();
    dispatch(logout());
    dispatch(resetSettings());
    dispatch(clearNotes());
    dispatch(clearTree());
    clearLibraryScope(dispatch);
    dispatch(clearNotifications());
    dispatch(clearPresence());
    dispatch(clearPermissions());
    dispatch(clearAdmin());
    dispatch(clearComments());
    dispatch(clearChatChannels());
    dispatch(clearChatMessages());
    dispatch(clearChatThreads());
    dispatch(clearChatUi());
    dispatch(clearChatDrafts());
    dispatch(clearAgentMessages());
    dispatch(clearAgentMemories());
    dispatch(clearAgentProviders());
    dispatch(clearAgentRuntimeSettings());
    dispatch(clearIntegrations());
    dispatch(clearTags());
    dispatch(clearPeople());
    dispatch(clearCalls());
    dispatch(clearRooms());
    dispatch(resetCalendarState());
    dispatch(resetCalendarUiState());
    clearNotesCache().catch(console.error);
    clearBlobCache();
    navigate("/auth");
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
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full overflow-hidden",
          "border border-border transition-all duration-150",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen ? "border-primary/30" : "hover:border-border",
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
        <div className="absolute right-0 z-100 mt-1.5 w-[min(240px,calc(100vw-2rem))] origin-top-right rounded-lg bg-card py-1.5 shadow-lg border border-border animate-in fade-in slide-in-from-top-2 duration-200">
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
    </div>
  );
}
