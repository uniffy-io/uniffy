import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { callsApi } from "@features/calls/callsApi";

export function useCallModeration(callId: string | null, hostUserId?: string) {
  const { organizationId } = useAuth();
  const query = useQuery({
    queryKey: ["calls", "moderation", organizationId, callId, hostUserId],
    queryFn: () => callsApi.getCallState({ organizationId: organizationId!, callId: callId! }),
    enabled: !!organizationId && !!callId,
  });
  return query.data?.canModerate ?? false;
}
