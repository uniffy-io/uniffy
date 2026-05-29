"""Single source of truth for mapping ``ContentRole`` to capabilities.

A role has a capability iff its ordinal is at least the ``MIN_FOR_*`` threshold.
``BLOCKED`` (ordinal -1) and ``None`` fail every check.
"""

from uniffy.core.types import ContentRole

ROLE_ORDINAL: dict[ContentRole, int] = {
    ContentRole.BLOCKED: -1,
    ContentRole.VIEWER: 1,
    ContentRole.COMMENTER: 2,
    ContentRole.EDITOR: 3,
    ContentRole.ADMIN: 4,
    ContentRole.OWNER: 5,
}


MIN_FOR_VIEW: int = ROLE_ORDINAL[ContentRole.VIEWER]
MIN_FOR_COMMENT: int = ROLE_ORDINAL[ContentRole.COMMENTER]
MIN_FOR_EDIT: int = ROLE_ORDINAL[ContentRole.EDITOR]
MIN_FOR_DELETE: int = ROLE_ORDINAL[ContentRole.ADMIN]
MIN_FOR_MANAGE: int = ROLE_ORDINAL[ContentRole.ADMIN]
MIN_FOR_TRANSFER: int = ROLE_ORDINAL[ContentRole.OWNER]


def role_can_view(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_VIEW


def role_can_comment(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_COMMENT


def role_can_edit(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_EDIT


def role_can_delete(role: ContentRole | None) -> bool:
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_DELETE


def role_can_manage(role: ContentRole | None) -> bool:
    """Add/remove members, change access mode or baseline role; ADMIN floor (same as delete)."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_MANAGE


def role_can_transfer(role: ContentRole | None) -> bool:
    """OWNER only - only the content owner can transfer ownership."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_TRANSFER


def role_is_higher_than(a: ContentRole, b: ContentRole) -> bool:
    return ROLE_ORDINAL[a] > ROLE_ORDINAL[b]


def max_role(roles: list[ContentRole]) -> ContentRole | None:
    """Highest role in the list, or ``None`` if empty. BLOCKED ranks lowest here."""
    if not roles:
        return None
    return max(roles, key=lambda r: ROLE_ORDINAL[r])
