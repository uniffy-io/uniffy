"""Organization repository for database operations."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models import Organization, OrganizationMember, OrganizationRole


async def get_organization_by_id(
    session: AsyncSession, organization_id: UUID
) -> Organization | None:
    """
    Get an organization by ID.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID to lookup.

    Returns
    -------
    Organization | None
        Organization if found, None otherwise.

    """
    result = await session.execute(select(Organization).where(Organization.id == organization_id))
    return result.scalar_one_or_none()


async def get_organization_by_slug(session: AsyncSession, slug: str) -> Organization | None:
    """
    Get an organization by slug.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    slug : str
        Organization slug to lookup.

    Returns
    -------
    Organization | None
        Organization if found, None otherwise.

    """
    result = await session.execute(select(Organization).where(Organization.slug == slug))
    return result.scalar_one_or_none()


async def get_user_organization_membership(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> OrganizationMember | None:
    """
    Get a user's membership in an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User ID.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    OrganizationMember | None
        Membership if found, None otherwise.

    """
    result = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def create_organization(
    session: AsyncSession,
    name: str,
    slug: str,
    owner_user_id: UUID,
    domain: str | None = None,
) -> Organization:
    """
    Create a new organization with an owner.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    name : str
        Organization name.
    slug : str
        Organization slug.
    owner_user_id : UUID
        User ID who will own the organization.
    domain : str | None
        Optional email domain.

    Returns
    -------
    Organization
        Created organization.

    """
    org = Organization(name=name, slug=slug, domain=domain)
    session.add(org)
    await session.flush()

    # Create owner membership
    membership = OrganizationMember(
        user_id=owner_user_id,
        organization_id=org.id,
        role=OrganizationRole.OWNER,
    )
    session.add(membership)

    await session.commit()
    await session.refresh(org)
    return org


async def add_user_to_organization(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    role: OrganizationRole = OrganizationRole.MEMBER,
) -> OrganizationMember:
    """
    Add a user to an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User ID to add.
    organization_id : UUID
        Organization ID.
    role : OrganizationRole
        User's role in the organization.

    Returns
    -------
    OrganizationMember
        Created membership.

    """
    membership = OrganizationMember(
        user_id=user_id,
        organization_id=organization_id,
        role=role,
    )
    session.add(membership)
    await session.commit()
    await session.refresh(membership)
    return membership
