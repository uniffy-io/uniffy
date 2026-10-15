import { cn } from "@/shared/utils/cn";
import type { RealtimeStatus } from "@/features/realtime/protocol";
import { isStorageEncryptionReady } from "@/shared/crypto/storageEncryption";

interface RealtimeStatusBadgeProps {
  status: RealtimeStatus;
  className?: string;
}

interface StatusCopy {
  label: string;
  tone: string;
  dotPulse?: boolean;
  title?: string;
}

// Device persistence needs Web Crypto; without it only the open editor holds the edits.
function offlineCopy(): StatusCopy {
  return {
    label: "Offline",
    tone: "bg-muted text-muted-foreground",
    title: isStorageEncryptionReady()
      ? "Edits stay on this device and sync when the connection returns."
      : "Edits sync when the connection returns. This device cannot store them, so keep this editor open.",
  };
}

// Presence supplies the connected signal.
function describeStatus(status: RealtimeStatus): StatusCopy | null {
  switch (status) {
    case "connecting":
      return { label: "Connecting", tone: "bg-muted text-muted-foreground", dotPulse: true };
    case "disconnected":
      return { ...offlineCopy(), dotPulse: true };
    case "offline":
      return offlineCopy();
    case "update_rejected":
      return {
        label: "Edit too large to sync",
        title: "Keep or export your local draft, then reduce its size.",
        tone: "bg-red-500/15 text-red-600 dark:text-red-300",
      };
    case "permission_lost":
      return {
        label: "View-only - edit access removed",
        tone: "bg-red-500/15 text-red-600 dark:text-red-300",
      };
    case "access_lost":
      return {
        label: "Access lost",
        title:
          "This item was deleted or is no longer shared with you. Your local draft is retained.",
        tone: "bg-red-500/15 text-red-600 dark:text-red-300",
      };
    case "token_revoked":
      return {
        label: "Session ended - reload",
        tone: "bg-red-500/15 text-red-600 dark:text-red-300",
      };
    default:
      return null;
  }
}

export function RealtimeStatusBadge({ status, className }: RealtimeStatusBadgeProps) {
  const copy = describeStatus(status);
  if (!copy) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        "transition-colors duration-300",
        copy.tone,
        className,
      )}
      role="status"
      aria-live="polite"
      title={copy.title}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          copy.dotPulse ? "animate-pulse" : "opacity-80",
        )}
      />
      {copy.label}
    </span>
  );
}
