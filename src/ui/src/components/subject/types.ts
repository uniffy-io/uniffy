/**
 * Subject Types
 *
 * Shared type definitions for user/group subjects used across
 * SubjectAvatar, SubjectPicker, SubjectAvatarStack, and SubjectChip.
 */

import { SubjectType } from '@uniffy/proto/common/v1/common_pb';

/**
 * Numeric subject type constants matching the proto enum.
 * USER = 1, GROUP = 2.
 */
export const SUBJECT_TYPE = {
    USER: SubjectType.USER,
    GROUP: SubjectType.GROUP,
} as const;

export type SubjectTypeValue = typeof SUBJECT_TYPE[keyof typeof SUBJECT_TYPE];

/**
 * Unified subject representing a user or group.
 */
export interface Subject {
    id: string;
    type: SubjectTypeValue;
    name: string;
    email?: string;
    avatarUrl?: string;
    memberCount?: number;
}

/** Selection mode for SubjectPicker. */
export type SubjectPickerMode = 'single' | 'multi';

/** Filter which subject types appear in search results. */
export type SubjectTypeFilter = 'users' | 'groups' | 'all';

/** Avatar display sizes. */
export type SubjectAvatarSize = 'xs' | 'sm' | 'md' | 'lg';
