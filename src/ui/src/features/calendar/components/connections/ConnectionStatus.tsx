import { useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { useConnectAccount } from "@/features/calendar/hooks/useConnectAccount";
import { syncCalendarConnectionNow } from "@/features/calendar/store/calendarConnectionsThunks";
import type { CalendarInfo } from "@/features/calendar/types";
import { connectedStateCopy } from "@/features/calendar/utils/connectionCopy";
import { cn } from "@/shared/utils/cn";

interface ConnectionStatusProps {
  calendar: CalendarInfo;
}

/** The line under a connected calendar's row: first sync, paused, or what broke and the fix. */
export function ConnectionStatus({ calendar }: ConnectionStatusProps) {
  const dispatch = useAppDispatch();
  const { connect, pending } = useConnectAccount();
  const [syncing, setSyncing] = useState(false);
  const connection = calendar.connection;
  if (!connection) return null;
  const copy = connectedStateCopy(connection.state, connection.lastError, connection.provider);
  if (!copy) return null;

  const failed = connection.state === "failing" || connection.state === "broken";
  const reconnect = connection.state === "reauth_required" && connection.provider;
  const alarming = failed || connection.state === "reauth_required";

  const retry = async () => {
    setSyncing(true);
    await dispatch(syncCalendarConnectionNow(connection.connectionId));
    setSyncing(false);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 pl-9 pr-2 pb-1 text-xs",
        alarming ? "text-destructive" : "text-subtle-foreground",
      )}
      data-testid="connection-status"
      role={alarming ? "status" : undefined}
    >
      <span className="min-w-0 flex-1">{copy}</span>
      {reconnect && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void connect(reconnect, connection.connectionId)}
          loading={pending}
          className="shrink-0"
        >
          Reconnect
        </Button>
      )}
      {failed && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void retry()}
          loading={syncing}
          className="shrink-0"
        >
          Retry
        </Button>
      )}
    </div>
  );
}
