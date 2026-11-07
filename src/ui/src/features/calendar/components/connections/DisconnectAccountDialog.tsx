import { useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { disconnectCalendarConnection } from "@/features/calendar/store/calendarConnectionsThunks";
import type { CalendarProviderId } from "@/features/calendar/types/connections";
import { providerCalendarName, providerName } from "@/features/calendar/utils/connectionCopy";

interface DisconnectAccountDialogProps {
  connectionId: string;
  provider: CalendarProviderId | null;
  accountEmail: string;
  onClose: () => void;
}

export function DisconnectAccountDialog({
  connectionId,
  provider,
  accountEmail,
  onClose,
}: DisconnectAccountDialogProps) {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);

  return (
    <ConfirmDialog
      isOpen
      onClose={onClose}
      title={`Disconnect ${providerName(provider)}?`}
      message={`Uniffy stops syncing ${accountEmail}. Events already synced stay in both Uniffy and ${providerCalendarName(provider)}, but changes no longer flow between them.`}
      confirmLabel="Disconnect"
      variant="danger"
      loading={busy}
      onConfirm={async () => {
        setBusy(true);
        const outcome = await dispatch(disconnectCalendarConnection(connectionId));
        setBusy(false);
        if (disconnectCalendarConnection.fulfilled.match(outcome)) onClose();
      }}
    />
  );
}
