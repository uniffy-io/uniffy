import { useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { ConnectionsLoadError } from "@/features/calendar/components/connections/ConnectionsLoadError";
import { ProviderMark } from "@/features/calendar/components/connections/ProviderMark";
import { SidebarSectionAdd } from "@/features/calendar/components/sidebar/SidebarSection";
import { useConnectAccount } from "@/features/calendar/hooks/useConnectAccount";
import { fetchCalendarConnections } from "@/features/calendar/store/calendarConnectionsThunks";
import { providerName } from "@/features/calendar/utils/connectionCopy";

const MENU_LABEL = "Connect a calendar account";

/** The Connected section's add control: one entry per provider this organization configured. */
export function ConnectAccountMenu() {
  const dispatch = useAppDispatch();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { connect, pending } = useConnectAccount();
  const { providers, loaded, loading, error } = useAppSelector(
    (state) => state.calendarConnections,
  );
  const configured = providers.filter((entry) => entry.configured);

  const toggle = () => {
    if (!open && !loaded && !loading) void dispatch(fetchCalendarConnections());
    setOpen((value) => !value);
  };

  return (
    <>
      <SidebarSectionAdd label={MENU_LABEL} onClick={toggle} menu={{ ref: triggerRef, open }} />
      <ActionMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label={MENU_LABEL}
        align="right"
      >
        {configured.length === 0 && error && !loading ? (
          <ConnectionsLoadError className="px-3 py-2" />
        ) : configured.length === 0 ? (
          <p
            className="px-3 py-2 text-xs text-subtle-foreground"
            data-testid="connect-no-providers"
          >
            {loaded
              ? "No calendar service is set up for this organization yet. Ask an admin."
              : "Loading..."}
          </p>
        ) : (
          configured.map((entry) => (
            <ActionMenuItem
              key={entry.provider}
              disabled={pending}
              onClick={() => void connect(entry.provider)}
            >
              <ProviderMark provider={entry.provider} size={16} />
              Connect {providerName(entry.provider)}
            </ActionMenuItem>
          ))
        )}
      </ActionMenu>
    </>
  );
}
