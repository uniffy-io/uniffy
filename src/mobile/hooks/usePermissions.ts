import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { permissionsApi } from "@/api/permissionsApi";
import { directoryApi } from "@/api/directoryApi";
import {
  memberToPlain,
  policyToPlain,
  roleToProto,
  accessModeToProto,
  type SerializedMember,
  type SerializedPolicy,
  type RoleName,
  type AccessModeName,
  type SubjectKind,
} from "@/lib/permissionSerializer";
import { ContentType, SubjectType } from "@uniffy/proto/common/v1/common_pb";

export interface MembersResult {
  policy: SerializedPolicy | null;
  members: SerializedMember[];
}

export interface DirectorySubject {
  id: string;
  kind: SubjectKind;
  name: string;
  email?: string;
  avatarUrl?: string;
  memberCount?: number;
}

function membersKey(orgId: string | null, ct: ContentType, id: string) {
  return ["permissions", "members", orgId, ct, id];
}

export function useMembers(contentType: ContentType, contentId: string | undefined) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: membersKey(organizationId, contentType, contentId ?? ""),
    enabled: !!organizationId && !!contentId && isAuthenticated,
    queryFn: async (): Promise<MembersResult> => {
      const res = await permissionsApi.listMembers({
        organizationId: organizationId!,
        contentType,
        contentId: contentId!,
      });
      return {
        policy: res.policy ? policyToPlain(res.policy) : null,
        members: res.members.map(memberToPlain),
      };
    },
  });
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

export function useMemberMutations(contentType: ContentType, contentId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: membersKey(organizationId, contentType, contentId) });

  const subjectTypeProto = (kind: SubjectKind) =>
    kind === "GROUP" ? SubjectType.GROUP : SubjectType.USER;

  const addMember = useMutation({
    mutationFn: (args: { subjectId: string; subjectKind: SubjectKind; role: RoleName }) =>
      permissionsApi.addMember({
        organizationId: organizationId!,
        contentType,
        contentId,
        subjectType: subjectTypeProto(args.subjectKind),
        subjectId: args.subjectId,
        role: roleToProto(args.role),
      }),
    onSuccess: invalidate,
  });

  const updateRole = useMutation({
    mutationFn: (args: { subjectId: string; subjectKind: SubjectKind; role: RoleName }) =>
      permissionsApi.updateMemberRole({
        organizationId: organizationId!,
        contentType,
        contentId,
        subjectType: subjectTypeProto(args.subjectKind),
        subjectId: args.subjectId,
        newRole: roleToProto(args.role),
      }),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (args: { subjectId: string; subjectKind: SubjectKind }) =>
      permissionsApi.removeMember({
        organizationId: organizationId!,
        contentType,
        contentId,
        subjectType: subjectTypeProto(args.subjectKind),
        subjectId: args.subjectId,
      }),
    onSuccess: invalidate,
  });

  const setAccessMode = useMutation({
    mutationFn: (args: { mode: AccessModeName; baselineRole?: RoleName }) =>
      permissionsApi.setAccessMode({
        organizationId: organizationId!,
        contentType,
        contentId,
        accessMode: accessModeToProto(args.mode),
        baselineRole: args.baselineRole ? roleToProto(args.baselineRole) : undefined,
      }),
    onSuccess: invalidate,
  });

  const transferOwnership = useMutation({
    mutationFn: (newOwnerUserId: string) =>
      permissionsApi.transferOwnership({
        organizationId: organizationId!,
        contentType,
        contentId,
        newOwnerUserId,
      }),
    onSuccess: invalidate,
  });

  return { addMember, updateRole, removeMember, setAccessMode, transferOwnership };
}
