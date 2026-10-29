import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { callsApi } from "@features/calls/callsApi";
import { historyRecordToPlain, historyPersonToPlain } from "@features/calls/historySerializer";

export function useCallHistory(channelId?: string, callId?: string) {
  const { organizationId } = useAuth();
  return useInfiniteQuery({
    queryKey: ["calls", "history", organizationId, channelId, callId],
    enabled: !!organizationId,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      if (callId) {
        const result = await callsApi.getCallRecord({
          organizationId: organizationId!,
          callId,
          participantCursor: pageParam,
          pageSize: 50,
        });
        if (!result.record) throw new Error("Call unavailable");
        return {
          records: [historyRecordToPlain(result.record)],
          people: result.participants.map(historyPersonToPlain),
          cursor: result.nextParticipantCursor,
        };
      }
      const result = await callsApi.listCallHistory({
        organizationId: organizationId!,
        channelId,
        cursor: pageParam,
        pageSize: 50,
      });
      return {
        records: result.records.map(historyRecordToPlain),
        people: [],
        cursor: result.nextCursor,
      };
    },
    getNextPageParam: (page) => page.cursor || undefined,
  });
}
