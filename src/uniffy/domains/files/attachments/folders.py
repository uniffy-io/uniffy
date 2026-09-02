"""Resolve the protected folders used by attachment files."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentRole

ATTACHMENTS_FOLDER_NAME = "Attachments"
ORG_ATTACHMENTS_FOLDER_NAME = "Organization Attachments"


def is_attachment_staging_folder(folder: Folder | None) -> bool:
    return (
        folder is not None
        and folder.is_system
        and not folder.is_org_attachments
        and folder.name == ATTACHMENTS_FOLDER_NAME
        and folder.parent_id is None
    )


async def stage_personal_attachments_folder(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> Folder:
    result = await session.execute(
        select(Folder).where(
            Folder.organization_id == organization_id,
            Folder.owner_id == user_id,
            Folder.name == ATTACHMENTS_FOLDER_NAME,
            Folder.is_system == True,  # noqa: E712
            Folder.parent_id.is_(None),
        )
    )
    folder = result.scalar_one_or_none()
    if folder:
        return folder

    folder = Folder(
        organization_id=organization_id,
        owner_id=user_id,
        name=ATTACHMENTS_FOLDER_NAME,
        access_mode=AccessMode.OWNER_ONLY,
        baseline_role=None,
        is_system=True,
        parent_id=None,
    )
    session.add(folder)
    await session.flush()
    await session.refresh(folder)
    return folder


async def get_or_create_personal_attachments_folder(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> Folder:
    return await stage_personal_attachments_folder(session, user_id, organization_id)


async def get_or_create_org_attachments_folder(
    session: AsyncSession,
    organization_id: UUID,
) -> Folder:
    result = await session.execute(
        select(Folder).where(
            Folder.organization_id == organization_id,
            Folder.is_org_attachments == True,  # noqa: E712
            Folder.is_deleted == False,  # noqa: E712
        )
    )
    folder = result.scalar_one_or_none()
    if folder:
        return folder

    members = (
        await session.execute(
            select(OrganizationMember.user_id, OrganizationMember.role)
            .join(User, User.id == OrganizationMember.user_id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
            .order_by(OrganizationMember.joined_at)
        )
    ).all()
    if not members:
        raise NotFoundError("Organization", str(organization_id))

    role_rank = {OrganizationRole.OWNER: 0, OrganizationRole.ADMIN: 1}
    owner_user_id = min(members, key=lambda row: role_rank.get(row[1], 2))[0]
    folder = Folder(
        organization_id=organization_id,
        owner_id=owner_user_id,
        name=ORG_ATTACHMENTS_FOLDER_NAME,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        is_system=True,
        is_org_attachments=True,
        parent_id=None,
    )
    session.add(folder)
    await session.flush()
    await session.refresh(folder)
    return folder
