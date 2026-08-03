import { SubjectType } from '@uniffy/proto/common/v1/common_pb';

export const SUBJECT_TYPE = {
    USER: SubjectType.USER,
    GROUP: SubjectType.GROUP,
} as const;

export type SubjectTypeValue = typeof SUBJECT_TYPE[keyof typeof SUBJECT_TYPE];

export type SubjectGroupKind = 'team' | 'access';

export interface Subject {
    id: string;
    type: SubjectTypeValue;
    name: string;
    email?: string;
    avatarUrl?: string;
    memberCount?: number;
    /** Display-level distinction for GROUP subjects; the wire type stays USER/GROUP. */
    kind?: SubjectGroupKind;
    /** Private group visible to the actor through their own membership. */
    isPrivate?: boolean;
}

export type SubjectPickerMode = 'single' | 'multi';

export type SubjectTypeFilter = 'users' | 'groups' | 'all';

export type SubjectAvatarSize = 'xs' | 'sm' | 'md' | 'lg';
