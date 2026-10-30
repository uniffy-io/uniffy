import { Code, ConnectError } from "@connectrpc/connect";
import { infiniteQueryOptions, type QueryClient } from "@tanstack/react-query";
import { callsApi } from "@features/calls/callsApi";
import { historyRecordToPlain, historyPersonToPlain } from "@features/calls/historySerializer";

function accessLost(error: unknown): boolean {
  return (
    error instanceof ConnectError &&
    [Code.PermissionDenied, Code.NotFound, Code.Unauthenticated].includes(error.code)
  );
}

export function callHistoryOptions(
  queryClient: QueryClient,
  organizationId: string | null,
  channelId?: string,
  callId?: string,
) {
  const queryKey = ["calls", "history", organizationId, channelId, callId];
  return infiniteQueryOptions({
    queryKey,
    enabled: !!organizationId,
    initialPageParam: "",
    retry: (failures, error) => !accessLost(error) && failures < 1,
    queryFn: async ({ pageParam, signal }) => {
      try {
        if (callId) {
          const result = await callsApi.getCallRecord(
            {
              organizationId: organizationId!,
              callId,
              participantCursor: pageParam,
              pageSize: 50,
            },
            { signal },
          );
          if (!result.record) throw new Error("Call unavailable");
          return {
            records: [historyRecordToPlain(result.record)],
            people: result.participants.map(historyPersonToPlain),
            cursor: result.nextParticipantCursor,
          };
        }
        const result = await callsApi.listCallHistory(
          {
            organizationId: organizationId!,
            channelId,
            cursor: pageParam,
            pageSize: 50,
          },
          { signal },
        );
        return {
          records: result.records.map(historyRecordToPlain),
          people: [],
          cursor: result.nextCursor,
        };
      } catch (error) {
        // A canceled request must not clear data from a newer authorized fetch.
        if (!signal.aborted && accessLost(error)) {
          queryClient.setQueryData(queryKey, { pages: [], pageParams: [] });
        }
        throw error;
      }
    },
    getNextPageParam: (page) => page.cursor || undefined,
  });
}
