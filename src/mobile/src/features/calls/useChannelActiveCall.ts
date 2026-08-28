import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { callsApi } from "@features/calls/callsApi";
import { callToPlain } from "@features/calls/callsSerializer";
import {
  activeCallsKey,
  removeActiveCall,
  syncActiveCalls,
  upsertActiveCall,
  type ActiveCallsMap,
} from "@features/calls/useCallsState";

const CHANNEL_CALL_STALE_MS = 15_000;

/**
 * Opening a channel must not wait for the chat stream's next reconnect resync to
 * learn there is a call running. The result is folded into the shared active-call
 * map rather than returned, so every surface keeps reading one source through
 * `useActiveCall` and the header and the pill cannot disagree.
 */
export function useChannelActiveCall(channelId: string | undefined): void {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ["calls", "active-channel", organizationId ?? "", channelId ?? ""],
    enabled: !!organizationId && !!channelId,
    staleTime: CHANNEL_CALL_STALE_MS,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!organizationId || !channelId) return null;
      const response = await callsApi.getActiveCall({ organizationId, channelId });
      if (response.call) {
        const call = callToPlain(response.call);
        upsertActiveCall(queryClient, organizationId, call);
        return call.id;
      }
      // The map is keyed by channel, so a channel with no call has to be cleared
      // explicitly or a call that ended while the app was away lingers.
      const known = queryClient.getQueryData<ActiveCallsMap>(activeCallsKey(organizationId));
      const stale = known?.[channelId];
      if (stale) removeActiveCall(queryClient, organizationId, channelId, stale.id);
      return null;
    },
  });
}

/**
 * One snapshot for a whole list of channels. A per-row fetch would be one request
 * per visible channel, so the list pays for a single ListActiveCalls instead.
 */
export function useActiveCallsSnapshot(): void {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ["calls", "active-snapshot", organizationId ?? ""],
    enabled: !!organizationId,
    staleTime: CHANNEL_CALL_STALE_MS,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!organizationId) return 0;
      const response = await callsApi.listActiveCalls({ organizationId });
      syncActiveCalls(queryClient, organizationId, response.calls.map(callToPlain));
      return response.calls.length;
    },
  });
}
