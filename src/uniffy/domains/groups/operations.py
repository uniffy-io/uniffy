"""Group management operations."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.user import User


class GroupOperations:
    """Group management operations."""

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize group operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self._session = session

    # =========================================================================
    # Group CRUD
    # =========================================================================

    async def get_by_id(self, group_id: UUID) -> Group:
        """
        Get group by ID.

        Parameters
        ----------
        group_id : UUID
            Group ID.

        Returns
        -------
        Group
            Group instance.

        Raises
        ------
        NotFoundError
            If group not found.

        """
        result = await self._session.execute(select(Group).where(Group.id == group_id))
        group = result.scalar_one_or_none()
        if not group:
            raise NotFoundError("Group", str(group_id))
        return group

    async def create(
        self,
        organization_id: UUID,
        name: str,
        created_by_user_id: UUID,
        description: str | None = None,
        is_private: bool = False,
        is_default: bool = False,
    ) -> Group:
        """
        Create a new group.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        name : str
            Group name.
        created_by_user_id : UUID
            User creating the group.
        description : str | None
            Group description.
        is_private : bool
            Whether group is private.
        is_default : bool
            Whether new members auto-join.

        Returns
        -------
        Group
            Created group.

        """
        # Generate slug from name
        slug = name.lower().replace(" ", "-")

        group = Group(
            organization_id=organization_id,
            name=name,
            slug=slug,
            created_by_user_id=created_by_user_id,
            description=description,
            is_private=is_private,
            is_default=is_default,
        )
        self._session.add(group)
        await self._session.commit()
        await self._session.refresh(group)
        return group

    async def update(
        self,
        group_id: UUID,
        name: str | None = None,
        description: str | None = None,
        is_private: bool | None = None,
        is_default: bool | None = None,
    ) -> Group:
        """
        Update group details.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        name : str | None
            New name.
        description : str | None
            New description.
        is_private : bool | None
            Private status.
        is_default : bool | None
            Default status.

        Returns
        -------
        Group
            Updated group.

        """
        group = await self.get_by_id(group_id)

        if name is not None:
            group.name = name
            group.slug = name.lower().replace(" ", "-")
        if description is not None:
            group.description = description
        if is_private is not None:
            group.is_private = is_private
        if is_default is not None:
            group.is_default = is_default

        await self._session.commit()
        await self._session.refresh(group)
        return group

    async def delete(self, group_id: UUID) -> None:
        """
        Delete a group.

        Parameters
        ----------
        group_id : UUID
            Group ID.

        """
        group = await self.get_by_id(group_id)
        await self._session.delete(group)
        await self._session.commit()

    async def list_in_organization(
        self,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
        include_private: bool = False,
    ) -> tuple[list[tuple[Group, int]], int]:
        """
        List groups in an organization with member counts.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        page : int
            Page number.
        page_size : int
            Items per page.
        search : str | None
            Optional search query.
        include_private : bool
            Whether to include private groups.

        Returns
        -------
        tuple[list[tuple[Group, int]], int]
            List of (group, member_count) tuples and total count.

        """
        # Member count subquery
        member_count = (
            select(func.count(GroupMember.id))
            .where(GroupMember.group_id == Group.id)
            .correlate(Group)
            .scalar_subquery()
        )

        query = select(Group, member_count).where(Group.organization_id == organization_id)

        if not include_private:
            query = query.where(Group.is_private == False)  # noqa: E712

        if search:
            pattern = f"%{search}%"
            query = query.where(Group.name.ilike(pattern) | Group.description.ilike(pattern))

        # Count total
        count_base = select(Group.id).where(Group.organization_id == organization_id)
        if not include_private:
            count_base = count_base.where(Group.is_private == False)  # noqa: E712
        if search:
            count_base = count_base.where(
                Group.name.ilike(f"%{search}%") | Group.description.ilike(f"%{search}%")
            )
        count_query = select(func.count()).select_from(count_base.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(Group.name)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        groups_with_counts = [(row[0], row[1] or 0) for row in result.all()]

        return groups_with_counts, total

    # =========================================================================
    # Member Management
    # =========================================================================

    async def add_member(
        self,
        group_id: UUID,
        user_id: UUID,
        role: GroupRole = GroupRole.MEMBER,
    ) -> GroupMember:
        """
        Add user to group.

        Parameters
        ----------
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
        self._session.add(membership)
        await self._session.commit()
        await self._session.refresh(membership)
        return membership

    async def update_member_role(
        self,
        group_id: UUID,
        user_id: UUID,
        role: GroupRole,
    ) -> GroupMember:
        """
        Update a member's role in a group.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        user_id : UUID
            User ID.
        role : GroupRole
            New role.

        Returns
        -------
        GroupMember
            Updated membership.

        Raises
        ------
        NotFoundError
            If membership not found.

        """
        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if not membership:
            raise NotFoundError("GroupMember", f"{group_id}:{user_id}")

        membership.role = role
        await self._session.commit()
        await self._session.refresh(membership)
        return membership

    async def remove_member(self, group_id: UUID, user_id: UUID) -> None:
        """
        Remove user from group.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        user_id : UUID
            User ID.

        """
        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership:
            await self._session.delete(membership)
            await self._session.commit()

    async def get_member(self, group_id: UUID, user_id: UUID) -> tuple[GroupMember, User]:
        """
        Get a specific group member with user info.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        user_id : UUID
            User ID.

        Returns
        -------
        tuple[GroupMember, User]
            Membership and user info.

        Raises
        ------
        NotFoundError
            If membership not found.

        """
        result = await self._session.execute(
            select(GroupMember, User)
            .join(User, GroupMember.user_id == User.id)
            .where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        row = result.first()
        if not row:
            raise NotFoundError("GroupMember", f"{group_id}:{user_id}")
        return row[0], row[1]

    async def list_members(
        self,
        group_id: UUID,
        page: int = 1,
        page_size: int = 20,
        role_filter: GroupRole | None = None,
    ) -> tuple[list[tuple[GroupMember, User]], int]:
        """
        List group members.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        page : int
            Page number.
        page_size : int
            Items per page.
        role_filter : GroupRole | None
            Optional role filter.

        Returns
        -------
        tuple[list[tuple[GroupMember, User]], int]
            List of (membership, user) tuples and total count.

        """
        query = (
            select(GroupMember, User)
            .join(User, GroupMember.user_id == User.id)
            .where(GroupMember.group_id == group_id)
        )

        if role_filter is not None:
            query = query.where(GroupMember.role == role_filter)

        # Count
        count_base = select(GroupMember.id).where(GroupMember.group_id == group_id)
        if role_filter is not None:
            count_base = count_base.where(GroupMember.role == role_filter)
        count_query = select(func.count()).select_from(count_base.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(User.username)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        members = [(row[0], row[1]) for row in result.all()]

        return members, total

    # =========================================================================
    # User's Groups
    # =========================================================================

    async def get_user_groups(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Group]:
        """
        Get groups a user belongs to in an organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        list[Group]
            List of groups.

        """
        query = (
            select(Group)
            .join(GroupMember, Group.id == GroupMember.group_id)
            .where(
                GroupMember.user_id == user_id,
                GroupMember.is_active == True,  # noqa: E712
                Group.organization_id == organization_id,
            )
            .order_by(Group.name)
        )

        result = await self._session.execute(query)
        return list(result.scalars().all())
