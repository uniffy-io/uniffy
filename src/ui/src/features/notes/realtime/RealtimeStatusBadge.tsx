import { cn } from '@/shared/utils/cn';
import type { RealtimeStatus } from '@/features/realtime';

interface RealtimeStatusBadgeProps {
  status: RealtimeStatus;
  className?: string;
}

const OFFLINE_COPY = {
  label: 'Offline',
  tone: 'bg-muted text-muted-foreground',
  title: 'Edits stay on this device and sync when the connection returns.',
};

const COPY: Record<
  RealtimeStatus,
  { label: string; tone: string; dotPulse?: boolean; title?: string } | null
> = {
  idle: null,
  connecting: {
    label: 'Connecting',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
    dotPulse: true,
  },
  connected: {
    label: 'Live',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    title: 'Edits sync live and are saved on the server within a few seconds.',
  },
  syncing: {
    label: 'Syncing',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
    dotPulse: true,
    title: 'Local edits are still being sent to the server.',
  },
  disconnected: { ...OFFLINE_COPY, dotPulse: true },
  offline: OFFLINE_COPY,
  permission_lost: {
    label: 'View-only - edit access removed',
    tone: 'bg-red-500/15 text-red-600 dark:text-red-300',
  },
  token_revoked: {
    label: 'Session ended - reload',
    tone: 'bg-red-500/15 text-red-600 dark:text-red-300',
  },
};

export function RealtimeStatusBadge({ status, className }: RealtimeStatusBadgeProps) {
  const copy = COPY[status];
  if (!copy) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        copy.tone,
        className,
      )}
      role="status"
      aria-live="polite"
      title={copy.title}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current',
          copy.dotPulse ? 'animate-pulse' : 'opacity-80',
        )}
      />
      {copy.label}
    </span>
  );
}
