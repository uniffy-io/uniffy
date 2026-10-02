import type { Awareness } from "y-protocols/awareness";
import { useAppSelector } from "@/app/hooks";
import type { RealtimeStatus } from "@/features/realtime/protocol";
import { RealtimePresence } from "@/features/realtime/components/RealtimePresence";
import { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
import { cn } from "@/shared/utils/cn";
import { RecoveredDrafts } from "@/features/realtime/components/RecoveredDrafts";

interface RealtimeSessionStatusProps {
  status: RealtimeStatus;
  awareness: Awareness | null;
  className?: string;
}

/** Editor-header slot for a live doc: the active-editor avatar stack, plus a chip only when something is wrong (offline, access lost). Renders nothing until a session is attached. */
export function RealtimeSessionStatus({
  status,
  awareness,
  className,
}: RealtimeSessionStatusProps) {
  const user = useAppSelector((state) => state.auth.user);
  if (!awareness) return null;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <RealtimePresence
        awareness={awareness}
        localUserId={user?.id ?? null}
        localUserName={user?.fullName || user?.username || null}
        localHasAvatar={Boolean(user?.hasAvatar)}
      />
      <RealtimeStatusBadge status={status} />
      <RecoveredDrafts ydoc={awareness.doc} />
    </div>
  );
}
