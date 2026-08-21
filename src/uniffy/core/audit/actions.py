"""Canonical catalogue of audit action identifiers."""


class Action:
    """Dotted-string audit-action identifiers used as the ``action`` column in ``audit_events``."""

    # Auth
    AUTH_LOGIN_SUCCESS = "auth.login_success"
    AUTH_LOGIN_FAILURE = "auth.login_failure"
    AUTH_TOKEN_REFRESHED = "auth.token_refreshed"
    AUTH_TOKEN_REVOKED = "auth.token_revoked"
    AUTH_PASSWORD_CHANGED = "auth.password_changed"
    AUTH_SESSION_TERMINATED = "auth.session_terminated"
    AUTH_REGISTER_REJECTED = "auth.register_rejected"
    AUTH_REGISTER_SUCCESS = "auth.register_success"
    AUTH_INVITATION_ACCEPTED = "auth.invitation_accepted"
    AUTH_PASSWORD_RESET_REQUESTED = "auth.password_reset_requested"
    AUTH_PASSWORD_RESET_COMPLETED = "auth.password_reset_completed"
    AUTH_PASSWORD_RESET_BLOCKED = "auth.password_reset_blocked"
    AUTH_LOGIN_RATE_LIMITED = "auth.login_rate_limited"
    AUTH_REFRESH_REUSE_DETECTED = "auth.refresh_reuse_detected"

    # Auth - MFA (TOTP)
    AUTH_MFA_ENROLLMENT_STARTED = "auth.mfa_enrollment_started"
    AUTH_MFA_ENROLLED = "auth.mfa_enrolled"
    AUTH_MFA_VERIFIED = "auth.mfa_verified"
    AUTH_MFA_FAILED = "auth.mfa_failed"
    AUTH_MFA_RECOVERY_CODE_USED = "auth.mfa_recovery_code_used"
    AUTH_MFA_RECOVERY_CODES_REGENERATED = "auth.mfa_recovery_codes_regenerated"
    AUTH_MFA_DISABLED = "auth.mfa_disabled"
    AUTH_MFA_ADMIN_RESET = "auth.mfa_admin_reset"
    AUTH_MFA_PLATFORM_RESET = "auth.mfa_platform_reset"
    AUTH_MFA_PLATFORM_RESET_REQUESTED = "auth.mfa_platform_reset_requested"
    AUTH_MFA_PLATFORM_RESET_APPROVED = "auth.mfa_platform_reset_approved"
    AUTH_MFA_BREAK_GLASS_RESET = "auth.mfa_break_glass_reset"
    AUTH_MFA_POLICY_CHANGED = "auth.mfa_policy_changed"

    # Users
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_INVITED = "user.invited"
    USER_ACTIVATED = "user.activated"
    USER_DEACTIVATED = "user.deactivated"
    USER_EMAIL_CHANGED = "user.email_changed"
    USER_AVATAR_CHANGED = "user.avatar_changed"
    USER_DELETED = "user.deleted"
    USER_FORCE_LOGOUT = "user.force_logout"
    USER_SYSTEM_ADMIN_GRANTED = "user.system_admin_granted"
    USER_SYSTEM_ADMIN_REVOKED = "user.system_admin_revoked"

    # Organizations
    ORGANIZATION_CREATED = "organization.created"
    ORGANIZATION_SETTINGS_CHANGED = "organization.settings_changed"
    ORGANIZATION_MEMBER_ADDED = "organization.member_added"
    ORGANIZATION_MEMBER_REMOVED = "organization.member_removed"
    ORGANIZATION_MEMBER_ROLE_CHANGED = "organization.member_role_changed"
    ORGANIZATION_DELETED = "organization.deleted"
    ORGANIZATION_ENCRYPTION_KEY_ROTATED = "organization.encryption_key_rotated"
    ORGANIZATION_PERMISSION_DEFAULTS_CHANGED = "organization.permission_defaults_changed"
    ORGANIZATION_MEMBER_INVITED = "organization.member_invited"
    ORGANIZATION_MEMBER_ADDED_VIA_INVITE = "organization.member_added_via_invite"
    ORGANIZATION_INVITATION_REVOKED = "organization.invitation_revoked"
    ORGANIZATION_INVITATION_RESENT = "organization.invitation_resent"
    ORGANIZATION_SECURITY_SETTINGS_CHANGED = "organization.security_settings_changed"
    ORGANIZATION_SUSPENDED = "organization.suspended"
    ORGANIZATION_UNSUSPENDED = "organization.unsuspended"
    ORGANIZATION_DELETED_BY_PLATFORM = "organization.deleted_by_platform"
    ORGANIZATION_RESTORED = "organization.restored"
    ORGANIZATION_PURGED = "organization.purged"
    ORGANIZATION_PURGE_WARNING_SENT = "organization.purge_warning_sent"

    # Permissions (sourced via core/content/members.py emissions)
    PERMISSIONS_MEMBER_ADDED = "permissions.member_added"
    PERMISSIONS_MEMBER_REMOVED = "permissions.member_removed"
    PERMISSIONS_MEMBER_ROLE_CHANGED = "permissions.member_role_changed"
    PERMISSIONS_ACCESS_MODE_CHANGED = "permissions.access_mode_changed"
    PERMISSIONS_BASELINE_ROLE_CHANGED = "permissions.baseline_role_changed"
    PERMISSIONS_OWNERSHIP_TRANSFERRED = "permissions.ownership_transferred"
    PERMISSIONS_ACCESS_REQUESTED = "permissions.access_requested"
    PERMISSIONS_ACCESS_REQUEST_APPROVED = "permissions.access_request_approved"
    PERMISSIONS_ACCESS_REQUEST_DENIED = "permissions.access_request_denied"
    PERMISSIONS_ACCESS_REQUEST_CANCELED = "permissions.access_request_canceled"

    # Groups
    GROUP_CREATED = "group.created"
    GROUP_UPDATED = "group.updated"
    GROUP_DELETED = "group.deleted"
    GROUP_MEMBER_ADDED = "group.member_added"
    GROUP_MEMBER_REMOVED = "group.member_removed"
    GROUP_MEMBER_ROLE_CHANGED = "group.member_role_changed"

    # People
    PERSON_PROFILE_UPDATED = "person.profile_updated"
    PERSON_MANAGER_CHANGED = "person.manager_changed"
    TEAM_LEAD_CHANGED = "team.lead_changed"
    TEAM_PARENT_CHANGED = "team.parent_changed"
    IDENTITY_SOURCE_CREATED = "identity_source.created"
    IDENTITY_SOURCE_UPDATED = "identity_source.updated"
    IDENTITY_SOURCE_DELETED = "identity_source.deleted"
    IDENTITY_SYNC_COMPLETED = "identity_source.sync_completed"

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
    AGENT_RUNTIME_SETTINGS_UPDATED = "agent.runtime_settings_updated"

    # Agents - provider key toggles (separate from add / rotate / delete)
    AGENT_PROVIDER_KEY_TOGGLED = "agent.provider_key_toggled"

    # Agents - image gen (tool calls get a dynamic suffix via tool_call_action)
    AGENT_IMAGE_GENERATION = "agent.image_generation"

    # Integrations - connections (hint only, never the secret)
    INTEGRATION_CONNECTION_ADDED = "integration.connection_added"
    INTEGRATION_CONNECTION_UPDATED = "integration.connection_updated"
    INTEGRATION_CONNECTION_REMOVED = "integration.connection_removed"
    INTEGRATION_CONNECTION_TOGGLED = "integration.connection_toggled"

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
    FILE_VERSION_RESTORED = "file.version_restored"

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
    CHAT_CHANNEL_MEMBER_ROLE_CHANGED = "chat_channel.member_role_changed"
    CHAT_MESSAGE_DELETED_BY_ADMIN = "chat_message.deleted_by_admin"
    CHAT_POLICY_UPDATED = "chat.policy_updated"

    # Calls (join/leave stay unaudited - calls_participants is the durable
    # attendance record; the audit log carries lifecycle + moderation only)
    CALL_STARTED = "call.started"
    CALL_ENDED = "call.ended"
    CALL_PARTICIPANT_KICKED = "call.participant_kicked"
    CALL_PARTICIPANT_MUTED = "call.participant_muted"

    # Mail
    MAIL_SENT = "mail.sent"
    MAIL_SEND_FAILED = "mail.send_failed"
    MAIL_SUPPRESSED = "mail.suppressed"
    MAIL_CONFIG_UPDATED = "mail.config_updated"
    MAIL_CONFIG_CLEARED = "mail.config_cleared"
    MAIL_CONFIG_FORCE_CLEARED = "mail.config_force_cleared"
    MAIL_SUPPRESSION_REMOVED = "mail.suppression_removed"
    MAIL_SYSTEM_CONFIG_UPDATED = "mail.system_config_updated"
    MAIL_SYSTEM_CONFIG_CLEARED = "mail.system_config_cleared"

    # Deployment encryption
    DEPLOYMENT_ENCRYPTION_ROTATED = "deployment.encryption_rotated"

    # System config flags
    SYSTEM_PUBLIC_REGISTRATION_CHANGED = "system.public_registration_changed"

    # Support sessions (time-bound platform-operator grants into a tenant)
    SUPPORT_SESSION_REQUESTED = "support_session.requested"
    SUPPORT_SESSION_APPROVED = "support_session.approved"
    SUPPORT_SESSION_REJECTED = "support_session.rejected"
    SUPPORT_SESSION_STARTED = "support_session.started"
    SUPPORT_SESSION_REVOKED = "support_session.revoked"
    SUPPORT_SESSION_EXPIRED = "support_session.expired"
    SUPPORT_SESSION_CIPHER_BRIDGE_ATTEMPT = "support_session.cipher_bridge_attempt"
    SUPPORT_SESSION_CONSENT_MODE_CHANGED = "support_session.consent_mode_changed"

    # Rooms
    ROOM_CREATED = "room.created"
    ROOM_UPDATED = "room.updated"
    ROOM_ARCHIVED = "room.archived"
    ROOM_DELETED = "room.deleted"


def tool_call_action(tool_name: str) -> str:
    """Build the dynamic action identifier for an agent tool call."""
    return f"agent.tool_call.{tool_name}"
