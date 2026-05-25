"""Canonical catalogue of audit action identifiers.

Every row in ``audit_events`` carries a dotted-string ``action`` value
drawn from this module. New mutation call sites must add their action
constant here before emitting events - the enum is the source of truth
for the front-end filter UI and for retention / export tooling.

Agent-as-actor attribution
--------------------------

When an agent performs a mutation on behalf of its human owner, the
audit row attributes the action to the **human owner**, with the
agent's identity surfaced through ``details``::

    actor_user_id        = <human owner UUID>
    on_behalf_of_user_id = NULL
    actor_org_role       = <human's org role snapshot>
    details              = {
        "actor_kind": "agent",
        "agent_id":   "<agents_agents.id>",
        "tool_name":  "<tool name when applicable>",
        "target_urn": "<urn:uniffy:content:..."
    }

Rationale: auditor mental model maps actions to the responsible human.
``actor_user_id`` is the single indexed column for "what did user X
do" filters and surfaces both manual and agent-driven activity. The
UI renders an "agent" badge from ``details.actor_kind``.

``on_behalf_of_user_id`` is reserved for delegated-admin /
system-initiated flows where actor and beneficiary diverge. Stays
``NULL`` outside that pattern.
"""


class Action:
    """Dotted-string audit-action identifiers.

    Class-as-namespace pattern: ``Action.PERMISSIONS_MEMBER_ADDED``
    reads naturally at call sites and the constants live in one place
    for the actions enum / filter UI to enumerate.
    """

    # Auth
    AUTH_LOGIN_SUCCESS = "auth.login_success"
    AUTH_LOGIN_FAILURE = "auth.login_failure"
    AUTH_TOKEN_REFRESHED = "auth.token_refreshed"
    AUTH_TOKEN_REVOKED = "auth.token_revoked"
    AUTH_PASSWORD_CHANGED = "auth.password_changed"
    AUTH_SESSION_TERMINATED = "auth.session_terminated"
    AUTH_REGISTER_REJECTED = "auth.register_rejected"
    AUTH_INVITATION_ACCEPTED = "auth.invitation_accepted"
    AUTH_PASSWORD_RESET_REQUESTED = "auth.password_reset_requested"
    AUTH_PASSWORD_RESET_COMPLETED = "auth.password_reset_completed"
    AUTH_PASSWORD_RESET_BLOCKED = "auth.password_reset_blocked"

    # Users
    USER_INVITED = "user.invited"
    USER_ACTIVATED = "user.activated"
    USER_DEACTIVATED = "user.deactivated"
    USER_EMAIL_CHANGED = "user.email_changed"
    USER_AVATAR_CHANGED = "user.avatar_changed"
    USER_DELETED = "user.deleted"

    # Organizations
    ORGANIZATION_CREATED = "organization.created"
    ORGANIZATION_SETTINGS_CHANGED = "organization.settings_changed"
    ORGANIZATION_MEMBER_ADDED = "organization.member_added"
    ORGANIZATION_MEMBER_REMOVED = "organization.member_removed"
    ORGANIZATION_MEMBER_ROLE_CHANGED = "organization.member_role_changed"
    ORGANIZATION_DELETED = "organization.deleted"
    ORGANIZATION_ENCRYPTION_KEY_ROTATED = "organization.encryption_key_rotated"
    ORGANIZATION_MEMBER_INVITED = "organization.member_invited"
    ORGANIZATION_MEMBER_ADDED_VIA_INVITE = "organization.member_added_via_invite"
    ORGANIZATION_INVITATION_REVOKED = "organization.invitation_revoked"
    ORGANIZATION_INVITATION_RESENT = "organization.invitation_resent"
    ORGANIZATION_SECURITY_SETTINGS_CHANGED = "organization.security_settings_changed"

    # Permissions (sourced via core/content/members.py emissions)
    PERMISSIONS_MEMBER_ADDED = "permissions.member_added"
    PERMISSIONS_MEMBER_REMOVED = "permissions.member_removed"
    PERMISSIONS_MEMBER_ROLE_CHANGED = "permissions.member_role_changed"
    PERMISSIONS_ACCESS_MODE_CHANGED = "permissions.access_mode_changed"
    PERMISSIONS_BASELINE_ROLE_CHANGED = "permissions.baseline_role_changed"
    PERMISSIONS_OWNERSHIP_TRANSFERRED = "permissions.ownership_transferred"

    # Groups
    GROUP_CREATED = "group.created"
    GROUP_UPDATED = "group.updated"
    GROUP_DELETED = "group.deleted"
    GROUP_MEMBER_ADDED = "group.member_added"
    GROUP_MEMBER_REMOVED = "group.member_removed"

    # Domain admin
    DOMAIN_ADMIN_GRANTED = "domain_admin.granted"
    DOMAIN_ADMIN_REVOKED = "domain_admin.revoked"

    # Agents - CRUD
    AGENT_CREATED = "agent.created"
    AGENT_UPDATED = "agent.updated"
    AGENT_DELETED = "agent.deleted"
    AGENT_CLONED = "agent.cloned"

    # Agents - provider keys (fingerprint only, never the secret)
    AGENT_PROVIDER_KEY_ADDED = "agent.provider_key_added"
    AGENT_PROVIDER_KEY_ROTATED = "agent.provider_key_rotated"
    AGENT_PROVIDER_KEY_DELETED = "agent.provider_key_deleted"

    # Agents - skills (enable / disable land via the enabled_skills diff
    # on agent update; skill CRUD lives below and is admin metadata)
    AGENT_SKILL_ENABLED = "agent.skill_enabled"
    AGENT_SKILL_DISABLED = "agent.skill_disabled"
    AGENT_SKILL_CREATED = "agent.skill_created"
    AGENT_SKILL_UPDATED = "agent.skill_updated"
    AGENT_SKILL_DELETED = "agent.skill_deleted"

    # Agents - cost / billing surfaces (budgets, currency, quotas, rate limits)
    AGENT_BUDGET_CREATED = "agent.budget_created"
    AGENT_BUDGET_UPDATED = "agent.budget_updated"
    AGENT_BUDGET_DELETED = "agent.budget_deleted"
    AGENT_USER_QUOTA_CREATED = "agent.user_quota_created"
    AGENT_USER_QUOTA_UPDATED = "agent.user_quota_updated"
    AGENT_USER_QUOTA_DELETED = "agent.user_quota_deleted"
    AGENT_CURRENCY_RATE_UPSERTED = "agent.currency_rate_upserted"
    AGENT_CURRENCY_RATE_DELETED = "agent.currency_rate_deleted"
    AGENT_DISPLAY_CURRENCY_SET = "agent.display_currency_set"
    AGENT_RATE_LIMIT_CREATED = "agent.rate_limit_created"
    AGENT_RATE_LIMIT_UPDATED = "agent.rate_limit_updated"
    AGENT_RATE_LIMIT_DELETED = "agent.rate_limit_deleted"

    # Agents - provider key toggles (separate from add / rotate / delete)
    AGENT_PROVIDER_KEY_TOGGLED = "agent.provider_key_toggled"

    # Agents - image gen (tool calls get a dynamic suffix via tool_call_action)
    AGENT_IMAGE_GENERATION = "agent.image_generation"

    # Notes
    NOTE_DELETED = "note.deleted"
    NOTE_RESTORED = "note.restored"
    NOTE_PERMANENTLY_DELETED = "note.permanently_deleted"
    NOTE_MOVED = "note.moved"

    # Files
    FILE_DELETED = "file.deleted"
    FILE_RESTORED = "file.restored"
    FILE_PERMANENTLY_DELETED = "file.permanently_deleted"
    FILE_MOVED = "file.moved"
    FILE_UPLOADED = "file.uploaded"  # behind feature flag, default off

    # Calendar
    CALENDAR_EVENT_DELETED = "calendar_event.deleted"
    CALENDAR_EVENT_RESTORED = "calendar_event.restored"
    CALENDAR_EVENT_PERMANENTLY_DELETED = "calendar_event.permanently_deleted"
    CALENDAR_EVENT_MOVED = "calendar_event.moved"

    # Projects (archive / unarchive constants reserved; the project model
    # has no archive flag today)
    PROJECT_DELETED = "project.deleted"
    PROJECT_PERMANENTLY_DELETED = "project.permanently_deleted"
    PROJECT_RESTORED = "project.restored"
    PROJECT_ARCHIVED = "project.archived"
    PROJECT_UNARCHIVED = "project.unarchived"

    # Tasks
    TASK_DELETED = "task.deleted"
    TASK_RESTORED = "task.restored"
    TASK_PERMANENTLY_DELETED = "task.permanently_deleted"
    TASK_MOVED = "task.moved"

    # Chat
    CHAT_CHANNEL_CREATED = "chat_channel.created"
    CHAT_CHANNEL_UPDATED = "chat_channel.updated"
    CHAT_CHANNEL_ARCHIVED = "chat_channel.archived"
    CHAT_CHANNEL_UNARCHIVED = "chat_channel.unarchived"
    CHAT_CHANNEL_DELETED = "chat_channel.deleted"
    CHAT_CHANNEL_MEMBER_ADDED = "chat_channel.member_added"
    CHAT_CHANNEL_MEMBER_REMOVED = "chat_channel.member_removed"
    CHAT_CHANNEL_MEMBER_KICKED = "chat_channel.member_kicked"
    CHAT_MESSAGE_DELETED_BY_ADMIN = "chat_message.deleted_by_admin"

    # Mail
    MAIL_SENT = "mail.sent"
    MAIL_SEND_FAILED = "mail.send_failed"
    MAIL_SUPPRESSED = "mail.suppressed"
    MAIL_CONFIG_UPDATED = "mail.config_updated"
    MAIL_CONFIG_CLEARED = "mail.config_cleared"

    # Rooms
    ROOM_CREATED = "room.created"
    ROOM_UPDATED = "room.updated"
    ROOM_ARCHIVED = "room.archived"
    ROOM_DELETED = "room.deleted"


def tool_call_action(tool_name: str) -> str:
    """Build the dynamic action identifier for an agent tool call.

    Used by the agent ToolExecutor when emitting an audit row for a
    mutating (``read_only=False``) tool invocation. The resulting
    action follows ``agent.tool_call.<tool_name>``.
    """
    return f"agent.tool_call.{tool_name}"
