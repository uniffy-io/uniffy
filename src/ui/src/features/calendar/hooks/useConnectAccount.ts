import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppDispatch } from "@/app/hooks";
import { startCalendarConnection } from "@/features/calendar/store/calendarConnectionsThunks";
import type { CalendarProviderId } from "@/features/calendar/types/connections";

/** Leaves for the provider's sign-in; the callback page brings the member back here. */
export function useConnectAccount() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const [pending, setPending] = useState(false);

  const connect = useCallback(
    async (provider: CalendarProviderId, reconnectConnectionId?: string) => {
      setPending(true);
      const outcome = await dispatch(
        startCalendarConnection({
          provider,
          reconnectConnectionId,
          returnPath: `${location.pathname}${location.search}`,
        }),
      );
      if (startCalendarConnection.fulfilled.match(outcome)) {
        window.location.assign(outcome.payload);
        return;
      }
      setPending(false);
    },
    [dispatch, location.pathname, location.search],
  );

  return { connect, pending };
}
