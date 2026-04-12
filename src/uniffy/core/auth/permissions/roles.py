"""Content role capability helpers.

Single source of truth for mapping ``ContentRole`` values to capabilities.
Every permission check in the application -- whether in
``PermissionChecker``, a domain operation, or the frontend -- uses the
predicates defined here instead of inspecting role values inline.

Ordinal semantics
-----------------
Each role has an ordinal from the ``ROLE_ORDINAL`` dict:

    BLOCKED   = -1  (explicit deny, fails every check)
    VIEWER    =  1
    COMMENTER =  2
    EDITOR    =  3
    ADMIN     =  4
    OWNER     =  5

A subject has a capability iff its role's ordinal is at least the
``MIN_FOR_*`` threshold. ``BLOCKED`` fails every check because its
ordinal is below all thresholds. ``None`` (no role at all) fails every
check too.
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
    """Return True if ``role`` grants permission to view the content."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_VIEW


def role_can_comment(role: ContentRole | None) -> bool:
    """Return True if ``role`` grants permission to comment on the content."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_COMMENT


def role_can_edit(role: ContentRole | None) -> bool:
    """Return True if ``role`` grants permission to edit the content."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_EDIT


def role_can_delete(role: ContentRole | None) -> bool:
    """Return True if ``role`` grants permission to delete the content."""
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_DELETE


def role_can_manage(role: ContentRole | None) -> bool:
    """Return True if ``role`` grants permission to manage the content.

    Managing a content item means: adding / removing members, changing
    the access mode, changing the baseline role. Deletion requires the
    same threshold (``MIN_FOR_DELETE``); the two are equivalent in the
    current model and ADMIN is the floor for both.
    """
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_MANAGE


def role_can_transfer(role: ContentRole | None) -> bool:
    """Return True if ``role`` grants permission to transfer ownership.

    Only the current owner can transfer ownership. Org and domain admins
    bypass this check at a higher level in ``PermissionChecker``.
    """
    return role is not None and ROLE_ORDINAL[role] >= MIN_FOR_TRANSFER


def role_is_higher_than(a: ContentRole, b: ContentRole) -> bool:
    """Return True if role ``a`` has a strictly higher ordinal than ``b``."""
    return ROLE_ORDINAL[a] > ROLE_ORDINAL[b]


def max_role(roles: list[ContentRole]) -> ContentRole | None:
    """Return the highest role in the list, or None if the list is empty.

    BLOCKED is treated as the lowest priority for this helper; if you
    need BLOCKED-wins semantics, handle BLOCKED separately before calling.
    """
    if not roles:
        return None
    return max(roles, key=lambda r: ROLE_ORDINAL[r])
