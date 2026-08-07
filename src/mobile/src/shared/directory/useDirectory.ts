import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { directoryApi } from "@shared/directory/directoryApi";
import type { SubjectKind } from "@shared/permissions/permissionSerializer";

export interface DirectorySubject {
  id: string;
  kind: SubjectKind;
  name: string;
  email?: string;
  avatarUrl?: string;
  memberCount?: number;
}

/** Loads org members + groups once; provides a name resolver and a search list. */
export function useDirectory() {
  const { organizationId, isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: ["directory", organizationId],
    enabled: !!organizationId && isAuthenticated,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DirectorySubject[]> => {
      const [members, groups] = await Promise.all([
        directoryApi.listMembers({
          organizationId: organizationId!,
          pagination: { page: 1, pageSize: 200 },
        }),
        directoryApi.listGroups({
          organizationId: organizationId!,
          pagination: { page: 1, pageSize: 200 },
        }),
      ]);
      const subjects: DirectorySubject[] = [
        ...members.members.map((m) => ({
          id: m.userId,
          kind: "USER" as const,
          name: m.displayName || m.email,
          email: m.email,
          avatarUrl: m.avatarUrl || undefined,
        })),
        ...groups.groups.map((g) => ({
          id: g.id,
          kind: "GROUP" as const,
          name: g.name,
          memberCount: g.memberCount,
        })),
      ];
      return subjects;
    },
  });

  const byId = useMemo(() => {
    const map = new Map<string, DirectorySubject>();
    for (const s of query.data ?? []) map.set(s.id, s);
    return map;
  }, [query.data]);

  return { subjects: query.data ?? [], byId, isLoading: query.isLoading };
}
