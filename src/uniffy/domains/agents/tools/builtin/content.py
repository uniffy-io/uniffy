"""Shared creation-space contract for agent write tools."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.types import AccessMode, ContentType

PERSONAL_SPACE = "personal"
ORGANIZATION_SPACE = "organization"
SHARED_SPACE = "shared"


def creation_space_schema() -> dict:
    return {
        "type": "string",
        "enum": [PERSONAL_SPACE, ORGANIZATION_SPACE],
        "description": (
            "Where to create the content: 'personal' is private to the user; "
            "'organization' is visible to all organization members. Omit this for a "
            "top-level Personal item. A chosen parent folder establishes the space for "
            "nested content. 'Shared' is not a creation destination."
        ),
    }


def parse_creation_space(args: dict) -> tuple[AccessMode | None, str | None]:
    raw_space = args.get("space")
    if raw_space == PERSONAL_SPACE:
        return AccessMode.OWNER_ONLY, None
    if raw_space == ORGANIZATION_SPACE:
        return AccessMode.OPEN_TO_ORG, None
    if raw_space is None:
        return AccessMode.OWNER_ONLY, None
    return None, (
        f"Invalid space: {raw_space}. Nothing was created. Use 'personal' or "
        "'organization'; Shared is not a creation destination."
    )


def space_for_access_mode(
    access_mode: AccessMode | None,
    default_access_mode: AccessMode | None,
    *,
    owner_id: UUID | None = None,
    current_user_id: UUID | None = None,
) -> str:
    effective_mode = access_mode or default_access_mode or AccessMode.OWNER_ONLY
    if effective_mode == AccessMode.OPEN_TO_ORG:
        return ORGANIZATION_SPACE
    if owner_id is not None and current_user_id is not None:
        return PERSONAL_SPACE if owner_id == current_user_id else SHARED_SPACE
    if effective_mode == AccessMode.EXPLICIT_MEMBERS:
        return SHARED_SPACE
    return PERSONAL_SPACE


async def effective_content_space(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    access_mode: AccessMode | None,
    *,
    owner_id: UUID | None = None,
    current_user_id: UUID | None = None,
) -> str:
    if access_mode is not None:
        return space_for_access_mode(
            access_mode,
            None,
            owner_id=owner_id,
            current_user_id=current_user_id,
        )
    default_mode, _ = await PermissionChecker(session).get_org_defaults(
        organization_id,
        content_type,
    )
    return space_for_access_mode(
        access_mode,
        default_mode,
        owner_id=owner_id,
        current_user_id=current_user_id,
    )


async def resolve_parent_access_mode(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    parent_access_mode: AccessMode | None,
    requested_access_mode: AccessMode,
    *,
    parent_owner_id: UUID,
    current_user_id: UUID,
    space_was_explicit: bool,
) -> tuple[AccessMode | None, str | None]:
    parent_space = await effective_content_space(
        session,
        organization_id,
        content_type,
        parent_access_mode,
        owner_id=parent_owner_id,
        current_user_id=current_user_id,
    )
    requested_space = space_for_access_mode(
        requested_access_mode,
        AccessMode.OWNER_ONLY,
    )
    if parent_space == SHARED_SPACE:
        return None, (
            "That folder is in Shared, which is not a creation destination. Nothing was "
            "created. Ask the user to choose a Personal or Organization destination."
        )
    parent_mode = (
        AccessMode.OPEN_TO_ORG if parent_space == ORGANIZATION_SPACE else AccessMode.OWNER_ONLY
    )
    if not space_was_explicit:
        return parent_mode, None
    if parent_space != requested_space:
        return None, (
            f"That folder is in {parent_space.title()}, but the requested space is "
            f"{requested_space.title()}. Nothing was created. Ask the user which location "
            "they want."
        )
    return requested_access_mode, None
