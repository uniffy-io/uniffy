import { type Ref, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Pause, Play, PlugsConnected, Trash } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { ConnectedCalendarSettings } from "@/features/calendar/components/connections/ConnectedCalendarSettings";
import { ConnectionsLoadError } from "@/features/calendar/components/connections/ConnectionsLoadError";
import { DisconnectAccountDialog } from "@/features/calendar/components/connections/DisconnectAccountDialog";
import { ProviderMark } from "@/features/calendar/components/connections/ProviderMark";
import { useConnectAccount } from "@/features/calendar/hooks/useConnectAccount";
import { closeConnectionsDialog } from "@/features/calendar/store/calendarConnectionsSlice";
import {
  fetchCalendarConnections,
  pauseCalendarConnection,
  resumeCalendarConnection,
  syncCalendarConnectionNow,
} from "@/features/calendar/store/calendarConnectionsThunks";
import type { CalendarConnectionInfo } from "@/features/calendar/types/connections";
import { connectionStatusCopy, providerName } from "@/features/calendar/utils/connectionCopy";
import { cn } from "@/shared/utils/cn";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";

const CONNECTION_REFRESH_MS = 10000;

/** The member's connected Google and Microsoft accounts and how each calendar syncs. */
export function ConnectionsModal() {
  const dispatch = useAppDispatch();
  const dialog = useAppSelector((state) => state.calendarConnections.dialog);
  const { connections, providers, canConnect, loaded, loading, error } = useAppSelector(
    (state) => state.calendarConnections,
  );
  const { connect, pending } = useConnectAccount();
  const focusRef = useRef<HTMLDivElement>(null);
  const focusConnectionId = dialog?.focusConnectionId ?? null;
  const open = dialog !== null;

  useEffect(() => {
    if (open) void dispatch(fetchCalendarConnections());
  }, [dispatch, open]);

  // Discovery can still be running before an account has any calendar rows.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(
      () => void dispatch(fetchCalendarConnections()),
      CONNECTION_REFRESH_MS,
    );
    return () => clearInterval(timer);
  }, [dispatch, open]);

  useEffect(() => {
    if (loaded && focusConnectionId) focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [loaded, focusConnectionId]);

  if (!open) return null;
  const close = () => dispatch(closeConnectionsDialog());
  const visible = connections.filter((connection) => connection.status !== "disconnected");
  const configured = canConnect ? providers.filter((entry) => entry.configured) : [];

  return (
    <Modal onClose={close} maxWidth="max-w-2xl">
      <ModalHeader
        title="Connected calendars"
        description="Choose which Google and Microsoft calendars sync with Uniffy."
      />
      <ModalBody>
        {!loaded && error && !loading ? (
          <ConnectionsLoadError className="py-6 text-sm" />
        ) : !loaded ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>
        ) : visible.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="no-connections"
          >
            No accounts connected yet.
          </p>
        ) : (
          <div className="space-y-4">
            {visible.map((connection) => (
              <AccountCard
                key={connection.id}
                connection={connection}
                focused={connection.id === focusConnectionId}
                cardRef={connection.id === focusConnectionId ? focusRef : undefined}
              />
            ))}
          </div>
        )}
      </ModalBody>
      <ModalFooter className="flex-wrap">
        <Button type="button" variant="ghost" onClick={close}>
          Close
        </Button>
        {configured.map((entry) => (
          <Button
            key={entry.provider}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void connect(entry.provider)}
          >
            <ProviderMark provider={entry.provider} size={16} />
            Connect {providerName(entry.provider)}
          </Button>
        ))}
      </ModalFooter>
    </Modal>
  );
}

interface AccountCardProps {
  connection: CalendarConnectionInfo;
  focused: boolean;
  cardRef?: Ref<HTMLDivElement>;
}

function AccountCard({ connection, focused, cardRef }: AccountCardProps) {
  const dispatch = useAppDispatch();
  const { connect, pending } = useConnectAccount();
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const paused = connection.status === "paused";
  const reauth = connection.status === "reauth_required";
  const provider = connection.provider;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };

  const calendars = [...connection.calendars].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(a.isSystem) - Number(b.isSystem),
  );

  return (
    <div
      ref={cardRef}
      className={cn("rounded-xl bg-card p-4 shadow-edge", focused && "shadow-edge-primary")}
      data-testid="connection-account"
    >
      <div className="flex flex-wrap items-start gap-3">
        <ProviderMark provider={connection.provider} size={20} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{connection.accountEmail}</p>
          <p className={cn("text-xs", reauth ? "text-destructive" : "text-subtle-foreground")}>
            {providerName(connection.provider)} · {connectionStatusCopy(connection.status)}
            {connection.lastSyncedAt && !reauth && (
              <> · synced {formatRelativeTime(connection.lastSyncedAt)}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {reauth && provider && (
            <Button
              type="button"
              size="sm"
              loading={pending}
              onClick={() => void connect(provider, connection.id)}
            >
              <PlugsConnected size={16} weight="duotone" />
              Reconnect
            </Button>
          )}
          {!reauth && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || paused}
              onClick={() => void run(() => dispatch(syncCalendarConnectionNow(connection.id)))}
            >
              <ArrowsClockwise size={16} weight="duotone" />
              Sync now
            </Button>
          )}
          {!reauth && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  dispatch(
                    paused
                      ? resumeCalendarConnection(connection.id)
                      : pauseCalendarConnection(connection.id),
                  ),
                )
              }
            >
              {paused ? <Play size={16} weight="duotone" /> : <Pause size={16} weight="duotone" />}
              {paused ? "Resume" : "Pause"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmDisconnect(true)}
            className="text-destructive"
          >
            <Trash size={16} weight="duotone" />
            Disconnect
          </Button>
        </div>
      </div>

      {calendars.length > 0 && (
        <div className="mt-3 divide-y divide-border/60 border-t border-border/60">
          {calendars.map((calendar) => (
            <ConnectedCalendarSettings
              key={calendar.id}
              calendar={calendar}
              provider={connection.provider}
              disabled={paused || reauth}
            />
          ))}
        </div>
      )}

      {confirmDisconnect && (
        <DisconnectAccountDialog
          connectionId={connection.id}
          provider={connection.provider}
          accountEmail={connection.accountEmail}
          onClose={() => setConfirmDisconnect(false)}
        />
      )}
    </div>
  );
}
