import { useEffect, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { fetchMembers, fetchGroups } from '@/features/admin/store/adminThunks';
import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { subjectKindFromGroupKind } from '@/components/subject/utils';

/** Resolves IDs against admin.members/groups/agents; unresolved IDs get a truncated-ID fallback Subject. */
export function useSubjectResolver(ids: string[]): {
    subjects: Subject[];
    loading: boolean;
} {
    const dispatch = useAppDispatch();
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
        if (!membersFetched && !membersLoading) {
            dispatch(fetchMembers({ pageSize: 200 }));
        }
    }, [dispatch, membersFetched, membersLoading]);

    useEffect(() => {
        if (!groupsFetched && !groupsLoading) {
            dispatch(fetchGroups({}));
        }
    }, [dispatch, groupsFetched, groupsLoading]);

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
