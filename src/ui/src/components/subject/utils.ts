import type { CSSProperties } from 'react';
import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';

export function getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// Identity colors like urnColors, deliberately theme-independent. Kept in
// sync with the mobile Avatar so a person gets the same backdrop on both.
const AVATAR_GRADIENT_PAIRS: [string, string][] = [
    ['#7C5CFC', '#E64980'],
    ['#3b82f6', '#06b6d4'],
    ['#f43f5e', '#f97316'],
    ['#8b5cf6', '#ec4899'],
    ['#10b981', '#14b8a6'],
    ['#f59e0b', '#ef4444'],
    ['#6366f1', '#818cf8'],
    ['#0ea5e9', '#7c3aed'],
];

function hashName(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/** Deterministic gradient backdrop for avatarless subjects. */
export function getAvatarGradientStyle(name: string): CSSProperties {
    const [start, end] = AVATAR_GRADIENT_PAIRS[hashName(name) % AVATAR_GRADIENT_PAIRS.length];
    return { background: `linear-gradient(135deg, ${start}, ${end})` };
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
