import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Collaborator } from "@uniffy/proto/people/v1/people_pb";
import { isCurrentSession, sessionGeneration } from "@core/auth/sessionScope";
import { useAuth } from "@core/providers/AuthContext";
import { directoryApi } from "@shared/directory/directoryApi";
import type { DirectorySubject } from "@shared/directory/useDirectory";
import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";

const PAGE_SIZE = 20;
const PICK_FLUSH_MS = 2_000;
// The server's cap on one RecordPeoplePicks call.
const MAX_PICKS_PER_CALL = 20;
// Suggestions refetch on each open, but not again for a quick clear of the search field.
const SUGGESTIONS_STALE_MS = 5_000;

const pendingPicks = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSession = sessionGeneration();

function flushPicks(): void {
  flushTimer = undefined;
  // Picks queued before a sign-out belong to that session, never to the next one.
  if (isCurrentSession(pendingSession)) {
    for (const [organizationId, ids] of pendingPicks) {
      // Picks only tune suggestions, so a failed send is dropped rather than surfaced.
      directoryApi
        .recordPeoplePicks(organizationId, [...ids].slice(0, MAX_PICKS_PER_CALL))
        .catch(() => undefined);
    }
  }
  pendingPicks.clear();
}

function queuePick(organizationId: string, userId: string): void {
  if (!isCurrentSession(pendingSession)) {
    pendingPicks.clear();
    pendingSession = sessionGeneration();
  }
  const ids = pendingPicks.get(organizationId) ?? new Set<string>();
  ids.add(userId);
  pendingPicks.set(organizationId, ids);
  if (flushTimer === undefined) flushTimer = setTimeout(flushPicks, PICK_FLUSH_MS);
}

function toSubjects(collaborators: Collaborator[]): DirectorySubject[] {
  return collaborators.flatMap((c) =>
    c.member
      ? [
          {
            id: c.member.userId,
            kind: "USER" as const,
            name: c.member.displayName || c.member.email,
            email: c.member.email,
            avatarUrl: c.member.avatarUrl || undefined,
          },
        ]
      : [],
  );
}

/** People for a picker: the caller's ranked colleagues before typing, a server search after. */
export function usePeoplePicker({
  query,
  includeGroups,
  enabled,
}: {
  query: string;
  includeGroups: boolean;
  enabled: boolean;
}) {
  const { organizationId, user, isAuthenticated } = useAuth();
  const term = useDebouncedValue(query.trim(), 250);
  const ready = enabled && isAuthenticated && !!organizationId && !!user;

  const suggestions = useQuery({
    queryKey: ["people-suggestions", organizationId, user?.id],
    enabled: ready && !term,
    staleTime: SUGGESTIONS_STALE_MS,
    queryFn: async () => {
      const res = await directoryApi.listCollaborators({
        organizationId: organizationId!,
        limit: PAGE_SIZE,
      });
      return toSubjects(res.collaborators);
    },
  });

  const search = useQuery({
    queryKey: ["people-search", organizationId, user?.id, term, includeGroups],
    enabled: ready && !!term,
    staleTime: 30_000,
    queryFn: async (): Promise<DirectorySubject[]> => {
      const [people, groups] = await Promise.all([
        directoryApi.listCollaborators({
          organizationId: organizationId!,
          query: term,
          limit: PAGE_SIZE,
        }),
        includeGroups
          ? directoryApi.listGroups({
              organizationId: organizationId!,
              search: term,
              pagination: { page: 1, pageSize: PAGE_SIZE },
            })
          : null,
      ]);
      return [
        ...toSubjects(people.collaborators),
        ...(groups?.groups ?? []).map((g) => ({
          id: g.id,
          kind: "GROUP" as const,
          name: g.name,
          memberCount: g.memberCount,
        })),
      ];
    },
  });

  const recordPick = useCallback(
    (userId: string) => {
      if (!organizationId || userId === user?.id) return;
      queuePick(organizationId, userId);
    },
    [organizationId, user?.id],
  );

  const searching = !!term;
  const active = searching ? search : suggestions;
  return {
    results: active.data ?? [],
    isLoading: active.isLoading || query.trim() !== term,
    searching,
    recordPick,
  };
}
