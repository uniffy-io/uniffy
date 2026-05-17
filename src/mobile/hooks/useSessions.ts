import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/api/authApi";
import { useAuth } from "@/context/auth-context";
import { formatRelativeTimeFromIso } from "@/lib/noteSerializer";
import type { SessionInfo } from "@uniffy/proto/auth/v1/auth_pb";

export type SerializedSession = Omit<SessionInfo, "$typeName">;

export function useSessions() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: ["sessions"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const response = await authApi.listSessions();
      return response.sessions.map((s) => ({
        ...s,
        lastActivityFormatted: formatRelativeTimeFromIso(s.lastActivity),
      }));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    revokeSession: revokeMutation.mutate,
    isRevoking: revokeMutation.isPending,
    revokeOtherSessions: revokeOthersMutation.mutate,
    isRevokingOthers: revokeOthersMutation.isPending,
  };
}
