/**
 * Subject Utilities
 *
 * Canonical getInitials implementation and converters from
 * domain-specific types (MemberInfo, GroupInfo, ShareTarget) to Subject.
 */

import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';

/**
 * Extract initials from a display name.
 * Two-word names -> first letter of each word.
 * Single-word names -> first two characters.
 */
export function getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

/** Convert a serialized org member to a Subject. */
export function memberToSubject(m: SerializedMemberInfo): Subject {
    return {
        id: m.userId,
        type: SUBJECT_TYPE.USER,
        name: m.displayName,
        email: m.email,
        avatarUrl: m.avatarUrl || undefined,
    };
}

/** Convert a serialized group to a Subject. */
export function groupToSubject(g: SerializedGroupInfo): Subject {
    return {
        id: g.id,
        type: SUBJECT_TYPE.GROUP,
        name: g.name,
        memberCount: g.memberCount,
    };
}

/** Check if a subject is a user. */
export function isUserSubject(s: Subject): boolean {
    return s.type === SUBJECT_TYPE.USER;
}

/** Check if a subject is a group. */
export function isGroupSubject(s: Subject): boolean {
    return s.type === SUBJECT_TYPE.GROUP;
}
