import type { Awareness } from "y-protocols/awareness";
import { useAppSelector } from "@/app/hooks";
import type { RealtimeStatus } from "@/features/realtime/protocol";
import { RealtimePresence } from "@/features/realtime/components/RealtimePresence";
import { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
import { useDeviceRecoveryState, useDocSaveState } from "@/features/realtime/hooks/useDocSaveState";
import { cn } from "@/shared/utils/cn";
import { RecoveredDrafts } from "@/features/realtime/components/RecoveredDrafts";

interface RealtimeSessionStatusProps {
  status: RealtimeStatus;
  awareness: Awareness | null;
  docName: string | null;
  /** Viewers have no edits to save, so only connection and access problems show. */
  readOnly?: boolean;
  whenSynced?: Promise<void>;
  className?: string;
}

/** Editor-header slot for a live doc: the active-editor avatar stack, the persistence chip and recoverable drafts. Renders nothing until a session is attached. */
export function RealtimeSessionStatus({
  status,
  awareness,
  docName,
  readOnly = false,
  whenSynced,
  className,
}: RealtimeSessionStatusProps) {
  const user = useAppSelector((state) => state.auth.user);
  const save = useDocSaveState(readOnly ? null : docName);
  const device = useDeviceRecoveryState(docName);
  if (!awareness) return null;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <RealtimePresence
        awareness={awareness}
        localUserId={user?.id ?? null}
        localUserName={user?.fullName || user?.username || null}
        localHasAvatar={Boolean(user?.hasAvatar)}
      />
      <RealtimeStatusBadge status={status} save={save} storage={device.storage} />
      <RecoveredDrafts ydoc={awareness.doc} whenSynced={whenSynced} />
    </div>
  );
}
