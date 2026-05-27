import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';

export function getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

export function memberToSubject(m: SerializedMemberInfo): Subject {
    return {
        id: m.userId,
        type: SUBJECT_TYPE.USER,
        name: m.displayName,
        email: m.email,
        avatarUrl: m.avatarUrl || undefined,
    };
}

export function groupToSubject(g: SerializedGroupInfo): Subject {
    return {
        id: g.id,
        type: SUBJECT_TYPE.GROUP,
        name: g.name,
        memberCount: g.memberCount,
    };
}

export function isUserSubject(s: Subject): boolean {
    return s.type === SUBJECT_TYPE.USER;
}

export function isGroupSubject(s: Subject): boolean {
    return s.type === SUBJECT_TYPE.GROUP;
}
