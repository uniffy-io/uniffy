/**
 * Subject Components
 *
 * Shared components for displaying and selecting users and groups.
 */

// Types
export type {
    Subject,
    SubjectTypeValue,
    SubjectPickerMode,
    SubjectTypeFilter,
    SubjectAvatarSize,
} from '@/components/subject/types';
export { SUBJECT_TYPE } from '@/components/subject/types';

// Utils
export {
    getInitials,
    memberToSubject,
    groupToSubject,
    shareTargetToSubject,
    subjectToShareTarget,
    isUserSubject,
    isGroupSubject,
} from '@/components/subject/utils';

// Components
export { PresenceIndicator } from '@/components/subject/PresenceIndicator';
export { SubjectAvatar, SubjectAvatarById } from '@/components/subject/SubjectAvatar';
export { SubjectAvatarStack } from '@/components/subject/SubjectAvatarStack';
export { SubjectChip } from '@/components/subject/SubjectChip';
export { SubjectPicker } from '@/components/subject/SubjectPicker';

// Hooks
export { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
export { useSubjectSearch } from '@/components/subject/hooks/useSubjectSearch';
