import { cn } from "@/shared/utils/cn";
import type { RealtimeStatus } from "@/features/realtime/protocol";

interface RealtimeStatusBadgeProps {
  status: RealtimeStatus;
  className?: string;
}

const OFFLINE_COPY = {
  label: "Offline",
  tone: "bg-muted text-muted-foreground",
  title: "Edits stay on this device and sync when the connection returns.",
};

/** Healthy states render nothing; the presence stack is the "live" signal. Only problems get a chip. */
const COPY: Record<
  RealtimeStatus,
  { label: string; tone: string; dotPulse?: boolean; title?: string } | null
> = {
  idle: null,
  connecting: null,
  connected: null,
  syncing: null,
  disconnected: { ...OFFLINE_COPY, dotPulse: true },
  offline: OFFLINE_COPY,
  permission_lost: {
    label: "View-only - edit access removed",
    tone: "bg-red-500/15 text-red-600 dark:text-red-300",
  },
  token_revoked: {
    label: "Session ended - reload",
    tone: "bg-red-500/15 text-red-600 dark:text-red-300",
  },
};

export function RealtimeStatusBadge({ status, className }: RealtimeStatusBadgeProps) {
  const copy = COPY[status];
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
