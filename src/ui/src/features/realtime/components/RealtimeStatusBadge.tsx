import { cn } from "@/shared/utils/cn";
import type { RealtimeStatus } from "@/features/realtime/protocol";
import type { SaveState } from "@/features/realtime/hooks/useDocSaveState";
import type { DeviceStorage } from "@/features/realtime/persistence/encryptedYjsPersistence";

interface RealtimeStatusBadgeProps {
  status: RealtimeStatus;
  /** Save progress of own edits, shown while the connection has nothing more urgent to say. */
  save?: SaveState | null;
  /** Whether this device holds the edits; copy promises a device copy only when it does. */
  storage: DeviceStorage;
  /** On phone widths only the colored dot shows; the label stays for screen readers and the title.
   * For crowded bars such as an editor toolbar, where a label would push the body down a row. */
  compact?: boolean;
  className?: string;
}

interface StatusCopy {
  label: string;
  tone: string;
  dotPulse?: boolean;
  title?: string;
}

const QUIET_TONE = "bg-muted text-muted-foreground";
const ALERT_TONE = "bg-red-500/15 text-red-600 dark:text-red-300";
const DELAYED_TONE = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";

const STORAGE_FAILED: StatusCopy = {
  label: "Not saved on device",
  title:
    "This device could not store your latest edits. Keep this editor open until it shows Saved.",
  tone: ALERT_TONE,
};

// Without a working device copy only the open editor holds the edits.
function offlineCopy(storage: DeviceStorage): StatusCopy {
  return {
    label: "Offline",
    tone: QUIET_TONE,
    title:
      storage === "available"
        ? "Edits stay on this device and sync when the connection returns."
        : "Edits sync when the connection returns. This device cannot store them, so keep this editor open.",
  };
}

function describeConnection(status: RealtimeStatus, storage: DeviceStorage): StatusCopy | null {
  switch (status) {
    case "connecting":
      return { label: "Connecting", tone: QUIET_TONE, dotPulse: true };
    case "disconnected":
      return { ...offlineCopy(storage), dotPulse: true };
    case "offline":
      return offlineCopy(storage);
    default:
      return null;
  }
}

function describeAlert(status: RealtimeStatus): StatusCopy | null {
  switch (status) {
    case "update_rejected":
      return {
        label: "Edit not synced",
        title:
          "This edit could not be synced. Keep or export your local draft. Very large edits must be smaller to sync.",
        tone: ALERT_TONE,
      };
    case "permission_lost":
      return { label: "View-only - edit access removed", tone: ALERT_TONE };
    case "access_lost":
      // A draft exists only for edits the server never accepted; RecoveredDrafts shows it then.
      return {
        label: "Access lost",
        title: "This item was deleted or is no longer shared with you.",
        tone: ALERT_TONE,
      };
    case "token_revoked":
      return { label: "Session ended - reload", tone: ALERT_TONE };
    case "upgrade_required":
      return {
        label: "Reload to keep saving",
        title: "Uniffy was updated. Reload this page to keep saving your edits.",
        tone: ALERT_TONE,
      };
    default:
      return null;
  }
}

function describeSave(save: SaveState, storage: DeviceStorage): StatusCopy {
  switch (save) {
    case "syncing":
      return { label: "Syncing", tone: QUIET_TONE, title: "Sending your latest edits." };
    case "synced":
      return {
        label: "Synced",
        tone: QUIET_TONE,
        title: "Shared with collaborators, saving shortly.",
      };
    case "unavailable":
      return {
        label: "Saving unavailable",
        tone: DELAYED_TONE,
        title:
          storage === "available"
            ? "Your edits stay on this device. Saving resumes automatically."
            : "Saving resumes automatically. This device cannot store your edits, so keep this editor open.",
      };
    case "delayed":
      return {
        label: "Saving delayed",
        tone: DELAYED_TONE,
        title:
          storage === "available"
            ? "Saving is taking longer than usual. Your edits stay on this device until they are saved."
            : "Saving is taking longer than usual. This device cannot store your edits, so keep this editor open.",
      };
    case "saved":
      return { label: "Saved", tone: QUIET_TONE, title: "All your edits are saved." };
  }
}

/** Persistence chip: access, rejection and reload problems first, then an unsaved device copy,
 * the connection and the save state. */
export function RealtimeStatusBadge({
  status,
  save = null,
  storage,
  compact = false,
  className,
}: RealtimeStatusBadgeProps) {
  const copy =
    describeAlert(status) ??
    (storage === "failed" && save !== null && save !== "saved" ? STORAGE_FAILED : null) ??
    describeConnection(status, storage) ??
    (save ? describeSave(save, storage) : null);
  if (!copy) return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        "transition-colors duration-300",
        copy.tone,
        className,
      )}
      role="status"
      aria-live="polite"
      title={compact ? [copy.label, copy.title].filter(Boolean).join(". ") : copy.title}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full bg-current",
          copy.dotPulse ? "animate-pulse" : "opacity-80",
        )}
      />
      <span className={cn("min-w-0 truncate", compact && "max-sm:sr-only")}>{copy.label}</span>
    </span>
  );
}
