"""Allowlist registry of valid template names; blocks attacker-controlled
paths into the Jinja loader.
"""

from dataclasses import dataclass

from uniffy.core.mail.errors import TemplateNotFoundError


@dataclass(frozen=True)
class MailTemplate:
    name: str
    description: str


TEMPLATES: dict[str, MailTemplate] = {
    "admin/test": MailTemplate(
        name="admin/test",
        description="Sent by the Admin > Email > Send Test button.",
    ),
    "auth/invitation": MailTemplate(
        name="auth/invitation",
        description="Org invitation to a brand-new email; carries the accept-link token.",
    ),
    "auth/added_to_org": MailTemplate(
        name="auth/added_to_org",
        description="Courtesy notice when an invited email matched an existing user.",
    ),
    "auth/password_reset": MailTemplate(
        name="auth/password_reset",
        description=(
            "Single-use password reset link dispatched from the user's primary-org SMTP config."
        ),
    ),
    "auth/mfa_reset": MailTemplate(
        name="auth/mfa_reset",
        description=(
            "Out-of-band notice sent to a user whose MFA was reset "
            "by an org admin, platform admin, or break-glass CLI."
        ),
    ),
    "platform/org_deleted": MailTemplate(
        name="platform/org_deleted",
        description=(
            "Sent to org owners when a platform operator soft-deletes "
            "the workspace. Surfaces the grace window and purge date."
        ),
    ),
    "platform/org_purge_warning": MailTemplate(
        name="platform/org_purge_warning",
        description=(
            "Sent to org owners 24 hours before a soft-deleted "
            "workspace is permanently purged. Final restore opportunity."
        ),
    ),
    "support/session_requested": MailTemplate(
        name="support/session_requested",
        description=(
            "Sent to org owners when a platform operator opens a "
            "PENDING support session. Carries the Approve/Reject link."
        ),
    ),
    "support/session_started": MailTemplate(
        name="support/session_started",
        description=(
            "Sent to org owners when a support session goes ACTIVE "
            "(approval or operator-justified mode)."
        ),
    ),
    "support/session_revoked": MailTemplate(
        name="support/session_revoked",
        description=(
            "Sent to org owners when an ACTIVE support session is "
            "revoked early (by operator or by org admin)."
        ),
    ),
}


def get_template(name: str) -> MailTemplate:
    try:
        return TEMPLATES[name]
    except KeyError as exc:
        raise TemplateNotFoundError(
            f"Template {name!r} is not registered",
            details={"available": sorted(TEMPLATES)},
        ) from exc
