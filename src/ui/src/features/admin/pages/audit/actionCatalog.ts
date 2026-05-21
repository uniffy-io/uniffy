/**
 * Frontend mirror of the backend audit action catalogue.
 *
 * The backend source of truth is `src/uniffy/core/audit/actions.py`. The
 * catalogue is mirrored here so the action multi-select can group filter
 * options by domain without round-tripping the catalogue over the wire.
 */

export interface ActionGroup {
    domain: string;
    label: string;
    /** Tailwind classes for the action badge in the table. */
    badgeClass: string;
    actions: readonly { value: string; label: string }[];
}

export const ACTION_GROUPS: readonly ActionGroup[] = [
    {
        domain: 'auth',
        label: 'Auth',
        badgeClass:
            'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
        actions: [
            { value: 'auth.login_success', label: 'Login success' },
            { value: 'auth.login_failure', label: 'Login failure' },
            { value: 'auth.token_refreshed', label: 'Token refreshed' },
            { value: 'auth.token_revoked', label: 'Token revoked' },
            { value: 'auth.password_changed', label: 'Password changed' },
            { value: 'auth.session_terminated', label: 'Session terminated' },
        ],
    },
    {
        domain: 'user',
        label: 'Users',
        badgeClass:
            'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
        actions: [
            { value: 'user.invited', label: 'Invited' },
            { value: 'user.activated', label: 'Activated' },
            { value: 'user.deactivated', label: 'Deactivated' },
            { value: 'user.email_changed', label: 'Email changed' },
            { value: 'user.avatar_changed', label: 'Avatar changed' },
            { value: 'user.deleted', label: 'Deleted' },
        ],
    },
    {
        domain: 'organization',
        label: 'Organizations',
        badgeClass:
            'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
        actions: [
            { value: 'organization.created', label: 'Created' },
            { value: 'organization.settings_changed', label: 'Settings changed' },
            { value: 'organization.member_added', label: 'Member added' },
            { value: 'organization.member_removed', label: 'Member removed' },
            { value: 'organization.member_role_changed', label: 'Member role changed' },
            { value: 'organization.deleted', label: 'Deleted' },
        ],
    },
    {
        domain: 'permissions',
        label: 'Permissions',
        badgeClass:
            'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
        actions: [
            { value: 'permissions.member_added', label: 'Member added' },
            { value: 'permissions.member_removed', label: 'Member removed' },
            { value: 'permissions.member_role_changed', label: 'Member role changed' },
            { value: 'permissions.access_mode_changed', label: 'Access mode changed' },
            { value: 'permissions.baseline_role_changed', label: 'Baseline role changed' },
            { value: 'permissions.ownership_transferred', label: 'Ownership transferred' },
        ],
    },
    {
        domain: 'group',
        label: 'Groups',
        badgeClass:
            'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
        actions: [
            { value: 'group.created', label: 'Created' },
            { value: 'group.updated', label: 'Updated' },
            { value: 'group.deleted', label: 'Deleted' },
            { value: 'group.member_added', label: 'Member added' },
            { value: 'group.member_removed', label: 'Member removed' },
        ],
    },
    {
        domain: 'domain_admin',
        label: 'Domain admins',
        badgeClass:
            'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
        actions: [
            { value: 'domain_admin.granted', label: 'Granted' },
            { value: 'domain_admin.revoked', label: 'Revoked' },
        ],
    },
    {
        domain: 'agent',
        label: 'Agents',
        badgeClass:
            'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
        actions: [
            { value: 'agent.created', label: 'Created' },
            { value: 'agent.updated', label: 'Updated' },
            { value: 'agent.deleted', label: 'Deleted' },
            { value: 'agent.cloned', label: 'Cloned' },
            { value: 'agent.provider_key_added', label: 'Provider key added' },
            { value: 'agent.provider_key_rotated', label: 'Provider key rotated' },
            { value: 'agent.provider_key_deleted', label: 'Provider key deleted' },
            { value: 'agent.provider_key_toggled', label: 'Provider key toggled' },
            { value: 'agent.skill_enabled', label: 'Skill enabled' },
            { value: 'agent.skill_disabled', label: 'Skill disabled' },
            { value: 'agent.skill_created', label: 'Skill created' },
            { value: 'agent.skill_updated', label: 'Skill updated' },
            { value: 'agent.skill_deleted', label: 'Skill deleted' },
            { value: 'agent.budget_created', label: 'Budget created' },
            { value: 'agent.budget_updated', label: 'Budget updated' },
            { value: 'agent.budget_deleted', label: 'Budget deleted' },
            { value: 'agent.user_quota_created', label: 'User quota created' },
            { value: 'agent.user_quota_updated', label: 'User quota updated' },
            { value: 'agent.user_quota_deleted', label: 'User quota deleted' },
            { value: 'agent.rate_limit_created', label: 'Rate limit created' },
            { value: 'agent.rate_limit_updated', label: 'Rate limit updated' },
            { value: 'agent.rate_limit_deleted', label: 'Rate limit deleted' },
            { value: 'agent.currency_rate_upserted', label: 'Currency rate upserted' },
            { value: 'agent.currency_rate_deleted', label: 'Currency rate deleted' },
            { value: 'agent.display_currency_set', label: 'Display currency set' },
            { value: 'agent.image_generation', label: 'Image generation' },
        ],
    },
    {
        domain: 'note',
        label: 'Notes',
        badgeClass:
            'bg-primary/15 text-primary',
        actions: [
            { value: 'note.deleted', label: 'Deleted' },
            { value: 'note.restored', label: 'Restored' },
            { value: 'note.permanently_deleted', label: 'Permanently deleted' },
            { value: 'note.moved', label: 'Moved' },
        ],
    },
    {
        domain: 'file',
        label: 'Files',
        badgeClass:
            'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        actions: [
            { value: 'file.deleted', label: 'Deleted' },
            { value: 'file.restored', label: 'Restored' },
            { value: 'file.permanently_deleted', label: 'Permanently deleted' },
            { value: 'file.moved', label: 'Moved' },
            { value: 'file.uploaded', label: 'Uploaded' },
        ],
    },
    {
        domain: 'calendar_event',
        label: 'Calendar',
        badgeClass:
            'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
        actions: [
            { value: 'calendar_event.deleted', label: 'Deleted' },
            { value: 'calendar_event.restored', label: 'Restored' },
            { value: 'calendar_event.permanently_deleted', label: 'Permanently deleted' },
            { value: 'calendar_event.moved', label: 'Moved' },
        ],
    },
    {
        domain: 'project',
        label: 'Projects',
        badgeClass:
            'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
        actions: [
            { value: 'project.deleted', label: 'Deleted' },
            { value: 'project.permanently_deleted', label: 'Permanently deleted' },
            { value: 'project.restored', label: 'Restored' },
            { value: 'project.archived', label: 'Archived' },
            { value: 'project.unarchived', label: 'Unarchived' },
        ],
    },
    {
        domain: 'task',
        label: 'Tasks',
        badgeClass:
            'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
        actions: [
            { value: 'task.deleted', label: 'Deleted' },
            { value: 'task.restored', label: 'Restored' },
            { value: 'task.permanently_deleted', label: 'Permanently deleted' },
            { value: 'task.moved', label: 'Moved' },
        ],
    },
    {
        domain: 'chat_channel',
        label: 'Chat',
        badgeClass:
            'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
        actions: [
            { value: 'chat_channel.created', label: 'Channel created' },
            { value: 'chat_channel.updated', label: 'Channel updated' },
            { value: 'chat_channel.archived', label: 'Channel archived' },
            { value: 'chat_channel.unarchived', label: 'Channel unarchived' },
            { value: 'chat_channel.deleted', label: 'Channel deleted' },
            { value: 'chat_channel.member_added', label: 'Channel member added' },
            { value: 'chat_channel.member_removed', label: 'Channel member removed' },
            { value: 'chat_channel.member_kicked', label: 'Channel member kicked' },
            { value: 'chat_message.deleted_by_admin', label: 'Message deleted by admin' },
        ],
    },
    {
        domain: 'room',
        label: 'Rooms',
        badgeClass:
            'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
        actions: [
            { value: 'room.created', label: 'Created' },
            { value: 'room.updated', label: 'Updated' },
            { value: 'room.archived', label: 'Archived' },
            { value: 'room.deleted', label: 'Deleted' },
        ],
    },
];

const ACTION_BADGE_DEFAULT =
    'bg-muted text-muted-foreground';

/**
 * Group key for an action string, derived from its dotted prefix.
 *
 * Dynamic tool-call actions (`agent.tool_call.<tool>`) collapse onto the
 * "agent" group so they share the same badge colour.
 */
export function actionDomain(action: string): string {
    if (action.startsWith('agent.tool_call.')) return 'agent';
    return action.split('.')[0] ?? '';
}

/**
 * Tailwind classes for the action badge by inspecting the action prefix.
 */
export function actionDomainColor(action: string): string {
    const key = actionDomain(action);
    const group = ACTION_GROUPS.find((g) => g.domain === key);
    return group?.badgeClass ?? ACTION_BADGE_DEFAULT;
}

/**
 * Human-readable label for any action string. Falls back to the raw
 * dotted string for unknown actions (e.g. dynamic tool-call ids).
 */
export function actionLabel(action: string): string {
    const key = actionDomain(action);
    const group = ACTION_GROUPS.find((g) => g.domain === key);
    if (!group) return action;
    const exact = group.actions.find((a) => a.value === action);
    if (exact) return `${group.label}: ${exact.label}`;
    if (action.startsWith('agent.tool_call.')) {
        const tool = action.slice('agent.tool_call.'.length);
        return `Agents: Tool call · ${tool}`;
    }
    return `${group.label}: ${action}`;
}

export const RESOURCE_TYPES: readonly { value: string; label: string }[] = [
    { value: 'NOTE', label: 'Note' },
    { value: 'FILE', label: 'File' },
    { value: 'CALENDAR_EVENT', label: 'Calendar event' },
    { value: 'PROJECT', label: 'Project' },
    { value: 'TASK', label: 'Task' },
    { value: 'AGENT', label: 'Agent' },
    { value: 'USER', label: 'User' },
    { value: 'GROUP', label: 'Group' },
    { value: 'CHAT_CHANNEL', label: 'Chat channel' },
    { value: 'CHAT_MESSAGE', label: 'Chat message' },
    { value: 'ROOM', label: 'Room' },
];
