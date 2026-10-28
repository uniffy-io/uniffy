import { useQuery } from "@tanstack/react-query";
import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";
import { useAuth } from "@core/providers/AuthContext";
import { callsApi } from "@features/calls/callsApi";
import { callAvailabilityMessage } from "@features/calls/callErrors";
import { callsSupported } from "@features/calls/livekit";

export function useCallAvailability(preparing: boolean) {
  const { organizationId } = useAuth();
  const query = useQuery({
    queryKey: ["calls", "availability", organizationId, preparing],
    queryFn: () =>
      callsApi.getCallAvailability({ organizationId: organizationId!, checkMedia: preparing }),
    enabled: !!organizationId && callsSupported,
    staleTime: 0,
    retry: false,
  });
  const availability = query.isError
    ? CallAvailability.UNREACHABLE
    : (query.data?.availability ?? CallAvailability.UNSPECIFIED);
  return {
    available: callsSupported && availability === CallAvailability.READY,
    message: callsSupported
      ? callAvailabilityMessage(availability)
      : "Calls are not supported by this app build. Update the app to enable calls.",
    checking: query.isFetching,
    retry: query.refetch,
  };
}
