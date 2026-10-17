import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import type { RealtimeStatus } from "@/features/realtime/protocol";

export function RealtimeConnectionNotice({
  waiting,
  status,
  onEditWithoutLive,
}: {
  waiting: boolean;
  status: RealtimeStatus;
  onEditWithoutLive?: () => void;
}) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setDelayed(true), 5000);
    return () => clearTimeout(timer);
  }, [waiting]);
  if (status === "update_rejected")
    return (
      <p role="status" className="px-6 py-3 text-sm text-muted-foreground">
        This edit could not be synced. Keep or export your local draft. Very large edits must be
        smaller to sync.
      </p>
    );
  if (!waiting) return null;
  // Recovered drafts show beside the editor when one exists, so this copy promises none.
  if (status === "permission_lost" || status === "access_lost" || status === "token_revoked") {
    return (
      <p role="status" className="px-6 py-3 text-sm text-muted-foreground">
        {status === "access_lost"
          ? "Access lost. This item was deleted or is no longer shared with you."
          : status === "permission_lost"
            ? "Edit access removed."
            : "Session ended. Reload to sign in."}
      </p>
    );
  }
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm text-muted-foreground"
    >
      <span>
        {status === "connected"
          ? "Waiting for another editor to finish loading..."
          : delayed
            ? "Can’t reach live editing. Check your connection or retry."
            : "Connecting to live editing..."}
      </span>
      {delayed && (
        <>
          <Button size="sm" variant="ghost" onClick={() => realtimeMultiplexer.retryConnection()}>
            Retry
          </Button>
          {onEditWithoutLive && (
            <Button size="sm" variant="ghost" onClick={onEditWithoutLive}>
              Edit without live updates
            </Button>
          )}
        </>
      )}
    </div>
  );
}
