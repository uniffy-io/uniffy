import { useEffect, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { fetchMembers, fetchGroups } from '@/features/admin/store/adminThunks';
import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';

/** Resolves IDs against admin.members/groups; unresolved IDs get a truncated-ID fallback Subject. */
export function useSubjectResolver(ids: string[]): {
    subjects: Subject[];
    loading: boolean;
} {
    const dispatch = useAppDispatch();
    const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
    const membersLoading = useAppSelector((state) => state.admin.membersLoading);
    const membersFetched = useAppSelector((state) => state.admin.membersFetched);
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
            const group = groupMap[id];
            if (group) {
                return {
                    id: group.id,
                    type: SUBJECT_TYPE.GROUP,
                    name: group.name,
                    memberCount: group.memberCount,
                };
            }
            return {
                id,
                type: SUBJECT_TYPE.USER,
                name: id.slice(-6),
            };
        });
    }, [ids, memberMap, groupMap]);

    return { subjects, loading: membersLoading || groupsLoading };
}
