import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { callHistoryOptions } from "@features/calls/historyQuery";

export function useCallHistory(channelId?: string, callId?: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useInfiniteQuery(callHistoryOptions(queryClient, organizationId, channelId, callId));
}
