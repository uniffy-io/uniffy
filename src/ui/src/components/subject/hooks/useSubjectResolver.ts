/**
 * useSubjectResolver Hook
 *
 * Resolves arrays of user/group IDs to Subject objects using the admin store.
 * Checks both state.admin.members (users) and state.admin.groups (groups).
 * Auto-dispatches fetchMembers/fetchGroups if the stores are empty.
 */

import { useEffect, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { fetchMembers, fetchGroups } from '@/features/admin/store/adminThunks';
import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';

/**
 * Resolve an array of user/group IDs to Subject objects.
 *
 * Looks up each ID in state.admin.members and state.admin.groups.
 * Unresolved IDs get a fallback Subject with the truncated ID as the name.
 */
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

    // Fetch members if not yet fetched
    useEffect(() => {
        if (!membersFetched && !membersLoading) {
            dispatch(fetchMembers({ pageSize: 200 }));
        }
    }, [dispatch, membersFetched, membersLoading]);

    // Fetch groups if not yet fetched
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
            // Fallback for unresolved IDs
            return {
                id,
                type: SUBJECT_TYPE.USER,
                name: id.slice(-6),
            };
        });
    }, [ids, memberMap, groupMap]);

    return { subjects, loading: membersLoading || groupsLoading };
}
