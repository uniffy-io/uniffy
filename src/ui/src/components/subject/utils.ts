import type { CSSProperties } from 'react';
import { GroupKind } from '@uniffy/proto/common/v1/common_pb';
import type { SerializedMemberInfo, SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SUBJECT_TYPE, type Subject, type SubjectGroupKind } from '@/components/subject/types';

export function getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// Identity gradients live on the Unity Violet #694aff <-> Belonging Pink
// #fd7eea axis only (docs/brand/palette.md); variants are the endpoints,
// interpolated midpoints (#8e57fa, #b364f4, #d871ef), and a deep violet
// shade. The duo reads well on dark and light and takes white initials.
// Kept in sync with the mobile Avatar so a person gets the same backdrop
// on both.
const AVATAR_GRADIENT_PAIRS: [string, string][] = [
    ['#694aff', '#fd7eea'],
    ['#fd7eea', '#694aff'],
    ['#694aff', '#b364f4'],
    ['#b364f4', '#fd7eea'],
    ['#543bcc', '#d871ef'],
    ['#8e57fa', '#fd7eea'],
    ['#694aff', '#d871ef'],
    ['#8e57fa', '#b364f4'],
];

// Same axis, darkened stops, so agents read as a distinct species next to
// people while keeping one visual language.
const AGENT_GRADIENT_PAIRS: [string, string][] = [
    ['#4a34b3', '#b158a4'],
    ['#b158a4', '#4a34b3'],
    ['#4a34b3', '#7d46ab'],
    ['#7d46ab', '#b158a4'],
    ['#3a298c', '#8c499b'],
    ['#5d43d6', '#b158a4'],
    ['#4a34b3', '#8c499b'],
    ['#5d43d6', '#7d46ab'],
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

/** Agent variant: darker stops on the same violet-pink axis. */
export function getAgentAvatarGradientStyle(name: string): CSSProperties {
    const [start, end] = AGENT_GRADIENT_PAIRS[hashName(name) % AGENT_GRADIENT_PAIRS.length];
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

export function subjectKindFromGroupKind(kind: number): SubjectGroupKind {
    return kind === GroupKind.TEAM ? 'team' : 'access';
}

export function groupToSubject(g: SerializedGroupInfo): Subject {
    return {
        id: g.id,
        type: SUBJECT_TYPE.GROUP,
        name: g.name,
        memberCount: g.memberCount,
        kind: subjectKindFromGroupKind(g.kind),
        isPrivate: g.isPrivate || undefined,
    };
}

export function isUserSubject(s: Subject): boolean {
    return s.type === SUBJECT_TYPE.USER;
}

export function isGroupSubject(s: Subject): boolean {
    return s.type === SUBJECT_TYPE.GROUP;
}

export interface SubjectSection {
    label: 'People' | 'Teams' | 'Groups';
    subjects: Subject[];
}

/** Sections for the mixed picker; empty sections are dropped. */
export function partitionSubjects(subjects: Subject[]): SubjectSection[] {
    const people: Subject[] = [];
    const teams: Subject[] = [];
    const groups: Subject[] = [];
    for (const subject of subjects) {
        if (subject.type === SUBJECT_TYPE.USER) {
            people.push(subject);
        } else if (subject.kind === 'team') {
            teams.push(subject);
        } else {
            groups.push(subject);
        }
    }
    const sections: SubjectSection[] = [
        { label: 'People', subjects: people },
        { label: 'Teams', subjects: teams },
        { label: 'Groups', subjects: groups },
    ];
    return sections.filter((section) => section.subjects.length > 0);
}
