import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { permissionsApi } from "@shared/permissions/permissionsApi";
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
} from "@shared/permissions/permissionSerializer";
import { ContentType, SubjectType } from "@uniffy/proto/common/v1/common_pb";

export interface MembersResult {
  policy: SerializedPolicy | null;
  members: SerializedMember[];
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
