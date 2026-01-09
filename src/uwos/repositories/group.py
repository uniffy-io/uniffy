"""Group repository for database operations."""

from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models.login.group import Group
from uwos.models.login.group_member import GroupMember, GroupRole
from uwos.models.login.user import User


async def get_group_by_id(session: AsyncSession, group_id: UUID) -> Group | None:
    """
    Get a group by ID.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.

    Returns
    -------
    Group | None
        Group if found, None otherwise.

    """
    result = await session.execute(select(Group).where(Group.id == group_id))
    return result.scalar_one_or_none()


async def get_group_by_slug(
    session: AsyncSession, organization_id: UUID, slug: str
) -> Group | None:
    """
    Get a group by slug within an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    slug : str
        Group slug.

    Returns
    -------
    Group | None
        Group if found, None otherwise.

    """
    result = await session.execute(
        select(Group).where(Group.organization_id == organization_id, Group.slug == slug)
    )
    return result.scalar_one_or_none()


async def create_group(
    session: AsyncSession,
    organization_id: UUID,
    name: str,
    slug: str,
    created_by_user_id: UUID,
    description: str | None = None,
    is_private: bool = False,
    is_default: bool = False,
) -> Group:
    """
    Create a new group.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    name : str
        Group name.
    slug : str
        Group slug.
    created_by_user_id : UUID
        User ID creating the group.
    description : str | None
        Optional description.
    is_private : bool
        Whether group is private.
    is_default : bool
        Whether group is default for new members.

    Returns
    -------
    Group
        Created group.

    """
    group = Group(
        organization_id=organization_id,
        name=name,
        slug=slug,
        created_by_user_id=created_by_user_id,
        description=description,
        is_private=is_private,
        is_default=is_default,
    )
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


async def update_group(session: AsyncSession, group_id: UUID, **kwargs) -> Group | None:
    """
    Update a group.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.
    **kwargs
        Fields to update.

    Returns
    -------
    Group | None
        Updated group if found.

    """
    valid_keys = {"name", "description", "is_private", "is_default"}
    update_data = {k: v for k, v in kwargs.items() if k in valid_keys and v is not None}

    if not update_data:
        return await get_group_by_id(session, group_id)

    stmt = (
        update(Group)
        .where(Group.id == group_id)
        .values(**update_data)
        .execution_options(synchronize_session="fetch")
    )

    await session.execute(stmt)
    await session.commit()

    return await get_group_by_id(session, group_id)


async def delete_group(session: AsyncSession, group_id: UUID) -> bool:
    """
    Delete a group.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.

    Returns
    -------
    bool
        True if deleted.

    """
    # Delete members first (cascade usually handles this but explicit is safe)
    await session.execute(delete(GroupMember).where(GroupMember.group_id == group_id))
    
    stmt = delete(Group).where(Group.id == group_id)
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount > 0


async def list_groups(
    session: AsyncSession,
    organization_id: UUID,
    page: int = 1,
    page_size: int = 20,
    query_str: str | None = None,
) -> tuple[list[tuple[Group, int]], int]:
    """
    List groups in an organization with member counts.

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
        Search query.

    Returns
    -------
    tuple[list[tuple[Group, int]], int]
        List of (Group, member_count) and total count.

    """
    # Count members subquery
    member_count_subquery = (
        select(func.count(GroupMember.id))
        .where(GroupMember.group_id == Group.id)
        .correlate(Group)
        .scalar_subquery()
    )

    stmt = select(Group, member_count_subquery.label("member_count")).where(
        Group.organization_id == organization_id
    )

    if query_str:
        search = f"%{query_str}%"
        stmt = stmt.where((Group.name.ilike(search)) | (Group.slug.ilike(search)))

    # Calculate total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await session.execute(count_stmt)
    total_count = total_result.scalar_one()

    # Apply pagination
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    stmt = stmt.order_by(Group.created_at.desc())

    result = await session.execute(stmt)
    return list(result.all()), total_count


async def add_group_member(
    session: AsyncSession,
    group_id: UUID,
    user_id: UUID,
    role: GroupRole = GroupRole.MEMBER,
) -> GroupMember:
    """
    Add user to group.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.
    user_id : UUID
        User ID.
    role : GroupRole
        Role in group.

    Returns
    -------
    GroupMember
        Created membership.

    """
    membership = GroupMember(
        group_id=group_id,
        user_id=user_id,
        role=role,
    )
    session.add(membership)
    await session.commit()
    await session.refresh(membership)
    return membership


async def remove_group_member(
    session: AsyncSession, group_id: UUID, user_id: UUID
) -> bool:
    """
    Remove user from group.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.
    user_id : UUID
        User ID.

    Returns
    -------
    bool
        True if removed.

    """
    stmt = delete(GroupMember).where(
        GroupMember.group_id == group_id, GroupMember.user_id == user_id
    )
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount > 0


async def get_group_membership(
    session: AsyncSession, group_id: UUID, user_id: UUID
) -> GroupMember | None:
    """
    Get user's membership in a group.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.
    user_id : UUID
        User ID.

    Returns
    -------
    GroupMember | None
        Membership if found.

    """
    result = await session.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def list_group_members(
    session: AsyncSession,
    group_id: UUID,
    page: int = 1,
    page_size: int = 20,
    query_str: str | None = None,
) -> tuple[list[tuple[GroupMember, User]], int]:
    """
    List members of a group with user details.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    group_id : UUID
        Group ID.
    page : int
        Page number.
    page_size : int
        Page size.
    query_str : str | None
        Search query for user name/email.

    Returns
    -------
    tuple[list[tuple[GroupMember, User]], int]
        List of (GroupMember, User) and total count.

    """
    stmt = (
        select(GroupMember, User)
        .join(User, GroupMember.user_id == User.id)
        .where(GroupMember.group_id == group_id)
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
    stmt = stmt.order_by(GroupMember.joined_at.desc())

    result = await session.execute(stmt)
    return list(result.all()), total_count
