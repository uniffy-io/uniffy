"""Organization repository for database operations."""

from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models import Organization, OrganizationMember, OrganizationRole, User


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
    plan: str = "free",
    is_active: bool = True,
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
    plan : str
        Subscription plan.
    is_active : bool
        Whether the organization is active.

    Returns
    -------
    Organization
        Created organization.

    """
    org = Organization(name=name, slug=slug, domain=domain, plan=plan, is_active=is_active)
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


async def get_user_organizations(
    session: AsyncSession, user_id: UUID
) -> list[tuple[Organization, OrganizationMember]]:
    """
    Get all organizations a user belongs to.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User ID.

    Returns
    -------
    list[tuple[Organization, OrganizationMember]]
        List of (Organization, OrganizationMember) tuples.

    """
    query = (
        select(Organization, OrganizationMember)
        .join(OrganizationMember, Organization.id == OrganizationMember.organization_id)
        .where(OrganizationMember.user_id == user_id)
        .where(OrganizationMember.is_active.is_(True))
        .where(Organization.is_active.is_(True))
    )
    result = await session.execute(query)
    return list(result.all())


async def list_all_organizations(
    session: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    query_str: str | None = None,
) -> tuple[list[tuple[Organization, int]], int]:
    """
    List all organizations with member counts, paginated.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    page : int
        Page number.
    page_size : int
        Page size.
    query_str : str | None
        Search query string (searches name or slug).

    Returns
    -------
    tuple[list[tuple[Organization, int]], int]
        List of (Organization, member_count) and total count.

    """
    # Count members subquery
    member_count_subquery = (
        select(func.count(OrganizationMember.id))
        .where(OrganizationMember.organization_id == Organization.id)
        .correlate(Organization)
        .scalar_subquery()
    )

    stmt = select(Organization, member_count_subquery.label("member_count"))

    if query_str:
        search = f"%{query_str}%"
        stmt = stmt.where((Organization.name.ilike(search)) | (Organization.slug.ilike(search)))

    # Calculate total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await session.execute(count_stmt)
    total_count = total_result.scalar_one()

    # Apply pagination
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    stmt = stmt.order_by(Organization.created_at.desc())

    result = await session.execute(stmt)
    return list(result.all()), total_count


async def update_organization(
    session: AsyncSession, organization_id: UUID, **kwargs
) -> Organization | None:
    """
    Update an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    **kwargs
        Fields to update.

    Returns
    -------
    Organization | None
        Updated organization if found, None otherwise.

    """
    # Filter out None values and invalid keys
    valid_keys = {"name", "domain", "plan", "is_active"}
    update_data = {k: v for k, v in kwargs.items() if k in valid_keys and v is not None}

    if not update_data:
        return await get_organization_by_id(session, organization_id)

    stmt = (
        update(Organization)
        .where(Organization.id == organization_id)
        .values(**update_data)
        .execution_options(synchronize_session="fetch")
    )

    await session.execute(stmt)
    await session.commit()

    return await get_organization_by_id(session, organization_id)


async def remove_user_from_organization(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> bool:
    """
    Remove a user from an organization.

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
    bool
        True if removed, False if not found.

    """
    stmt = delete(OrganizationMember).where(
        OrganizationMember.user_id == user_id,
        OrganizationMember.organization_id == organization_id,
    )
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount > 0


async def list_organization_users(
    session: AsyncSession,
    organization_id: UUID,
    page: int = 1,
    page_size: int = 20,
    query_str: str | None = None,
) -> tuple[list[User], int]:
    """
    List all users in an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    page : int
        Page number.
    page_size : int
        Page size.
    query_str : str | None
        Search query for user name/email.

    Returns
    -------
    tuple[list[User], int]
        List of users and total count.

    """
    stmt = (
        select(User)
        .join(OrganizationMember, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == organization_id)
    )

    if query_str:
        search = f"%{query_str}%"
        stmt = stmt.where(
            (User.email.ilike(search))
            | (User.username.ilike(search))
            | (User.full_name.ilike(search))
        )

    # Calculate total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await session.execute(count_stmt)
    total_count = total_result.scalar_one()

    # Apply pagination
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    stmt = stmt.order_by(User.username.asc())

    result = await session.execute(stmt)
    return list(result.all()), total_count