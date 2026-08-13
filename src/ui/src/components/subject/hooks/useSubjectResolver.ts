import { useEffect, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { fetchMembers, fetchGroups } from '@/features/admin/store/adminThunks';
import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { subjectKindFromGroupKind } from '@/components/subject/utils';

// A page can mount dozens of resolvers in one commit; their effects all see
// pre-dispatch flags, so without a module-level latch each one fires its own
// directory fetch.
let membersRequestInFlight = false;
let groupsRequestInFlight = false;

/** Resolves IDs against admin.members/groups/agents; unresolved IDs get a truncated-ID fallback Subject. */
export function useSubjectResolver(ids: string[]): {
    subjects: Subject[];
    loading: boolean;
} {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
    const membersLoading = useAppSelector((state) => state.admin.membersLoading);
    const membersFetched = useAppSelector((state) => state.admin.membersFetched);
    // Agents share the id space with users and appear wherever they act
    // (thread participants, channel rosters). Read-only: whichever surface owns
    // the agent list fetches it, so an id nobody loaded stays on the fallback.
    const agents = useAppSelector((state) => state.agents.agents);
    const groups = useAppSelector((state) => state.admin.groups) as SerializedGroupInfo[];
    const groupsLoading = useAppSelector((state) => state.admin.groupsLoading);
    const groupsFetched = useAppSelector((state) => state.admin.groupsFetched);

    useEffect(() => {
        // No org context (pure platform operator): there is no directory to
        // resolve against, so IDs stay on the fallback Subject.
        if (!organizationId || membersFetched || membersLoading || membersRequestInFlight) {
            return;
        }
        membersRequestInFlight = true;
        void dispatch(fetchMembers({ pageSize: 200 })).finally(() => {
            membersRequestInFlight = false;
        });
    }, [dispatch, organizationId, membersFetched, membersLoading]);

    useEffect(() => {
        if (!organizationId || groupsFetched || groupsLoading || groupsRequestInFlight) {
            return;
        }
        groupsRequestInFlight = true;
        void dispatch(fetchGroups({})).finally(() => {
            groupsRequestInFlight = false;
        });
    }, [dispatch, organizationId, groupsFetched, groupsLoading]);

    const memberMap = useMemo(() => {
        const map: Record<string, SerializedMemberInfo> = {};
        for (const m of members) {
            map[m.userId] = m;
        }
        return map;
    }, [members]);

    const groupMap = useMemo(() => {
        const map: Record<string, SerializedGroupInfo> = {};
        for (const g of groups) {
            map[g.id] = g;
        }
        return map;
    }, [groups]);

    const subjects = useMemo(() => {
        return (ids ?? []).map((id): Subject => {
            const member = memberMap[id];
            if (member) {
                return {
                    id: member.userId,
                    type: SUBJECT_TYPE.USER,
                    name: member.displayName,
                    email: member.email,
                    avatarUrl: member.avatarUrl || undefined,
                };
            }
            const agent = agents[id];
            if (agent) {
                return {
                    id: agent.id,
                    type: SUBJECT_TYPE.AGENT,
                    name: agent.name,
                    avatarUrl: agent.avatarKey || undefined,
                    avatarEmoji: agent.avatarEmoji || undefined,
                };
            }
            const group = groupMap[id];
            if (group) {
                return {
                    id: group.id,
                    type: SUBJECT_TYPE.GROUP,
                    name: group.name,
                    memberCount: group.memberCount,
                    kind: subjectKindFromGroupKind(group.kind),
                    isPrivate: group.isPrivate || undefined,
                };
            }
            return {
                id,
                type: SUBJECT_TYPE.USER,
                name: id.slice(-6),
            };
        });
    }, [ids, memberMap, groupMap, agents]);

    return { subjects, loading: membersLoading || groupsLoading };
}
