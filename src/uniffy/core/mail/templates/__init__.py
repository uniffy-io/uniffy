"""Registry of valid template names.

Restricting sends to a known set keeps user-supplied input out of the
filesystem-loader path: callers pass ``template_name`` strings around
and one of them could be attacker-controlled in a future flow. The
registry is the allowlist.
"""

from dataclasses import dataclass

from uniffy.core.mail.errors import TemplateNotFoundError


@dataclass(frozen=True)
class MailTemplate:
    """One row in the template registry."""

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
            "Single-use password reset link dispatched from the "
            "user's primary-org SMTP config."
        ),
    ),
}


def get_template(name: str) -> MailTemplate:
    """Return the registry entry for ``name`` or raise."""
    try:
        return TEMPLATES[name]
    except KeyError as exc:
        raise TemplateNotFoundError(
            f"Template {name!r} is not registered",
            details={"available": sorted(TEMPLATES)},
        ) from exc
