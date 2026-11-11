import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { fetchAllPages } from "@shared/lib/fetchAllPages";
import { sessionsApi } from "@features/agents/sessionsApi";
import { sessionLinesFromMessages, type SessionLine } from "@features/agents/agentSerializer";

const LIVE_REFRESH_MS = 2500;
const MESSAGE_PAGE_SIZE = 200;

/** The transcript of a background agent session, refreshed while the agent still works. */
export function useAgentSession(sessionId: string | undefined, live: boolean, enabled: boolean) {
  const { organizationId, isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["agent-session", organizationId, sessionId],
    enabled: enabled && !!sessionId && !!organizationId && isAuthenticated,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
    queryFn: async (): Promise<SessionLine[]> => {
      const messages = await fetchAllPages(
        async (page) => {
          const res = await sessionsApi.listMessages({
            organizationId: organizationId!,
            sessionId: sessionId!,
            pagination: { page, pageSize: MESSAGE_PAGE_SIZE },
          });
          return { items: res.messages, totalPages: res.pagination?.totalPages ?? 1 };
        },
        { key: (message) => message.id },
      );
      return sessionLinesFromMessages(messages);
    },
  });
}
