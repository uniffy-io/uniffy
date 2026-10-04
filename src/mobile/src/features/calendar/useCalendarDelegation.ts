import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { calendarApi } from "@features/calendar/calendarApi";
import {
  DELEGATION_LEVEL_TO_PROTO,
  delegationToPlain,
  type DelegationLevel,
} from "@features/calendar/calendarSerializer";
import { calendarsQueryKey } from "@features/calendar/useCalendar";

export const delegationsQueryKey = (organizationId: string | null | undefined) => [
  "calendar-delegations",
  organizationId,
];

/** Delegates the member has named, and the colleagues who named the member. */
export function useMyDelegations() {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: delegationsQueryKey(organizationId),
    queryFn: async () => {
      const response = await calendarApi.listMyCalendarDelegations({
        organizationId: organizationId!,
      });
      return {
        grantedByMe: response.grantedByMe.map(delegationToPlain),
        grantedToMe: response.grantedToMe.map(delegationToPlain),
      };
    },
    enabled: !!organizationId,
  });
}

export function useGrantDelegation() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { delegateId: string; level: DelegationLevel }) =>
      calendarApi.grantCalendarDelegation({
        organizationId: organizationId!,
        delegateId: args.delegateId,
        level: DELEGATION_LEVEL_TO_PROTO[args.level],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: delegationsQueryKey(organizationId) });
    },
  });
}

/** The grantor withdraws a delegation, or the delegate steps down; either changes the delegate's grid. */
export function useRevokeDelegation() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (delegationId: string) =>
      calendarApi.revokeCalendarDelegation({ organizationId: organizationId!, delegationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: delegationsQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: calendarsQueryKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
    },
  });
}
