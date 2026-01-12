"""Group management operations."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.errors import NotFoundError
from uwos.core.models.login.group import Group
from uwos.core.models.login.group_member import GroupMember, GroupRole
from uwos.core.models.login.user import User


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
        organization_id : UUID
            Organization ID.
        name : str
            Group name.
        slug : str
            URL-friendly slug.
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
        query_str: str | None = None,
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
        query_str : str | None
            Optional search query.

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

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(Group.name.ilike(pattern) | Group.description.ilike(pattern))

        # Count total
        count_base = select(Group.id).where(Group.organization_id == organization_id)
        if query_str:
            count_base = count_base.where(
                Group.name.ilike(f"%{query_str}%") | Group.description.ilike(f"%{query_str}%")
            )
        count_query = select(func.count()).select_from(count_base.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(Group.name)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        groups_with_counts = [(row[0], row[1] or 0) for row in result.all()]

        return groups_with_counts, total

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

    async def list_members(
        self,
        group_id: UUID,
        page: int = 1,
        page_size: int = 20,
        query_str: str | None = None,
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
        query_str : str | None
            Optional search query.

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

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(
                User.email.ilike(pattern)
                | User.username.ilike(pattern)
                | User.full_name.ilike(pattern)
            )

        # Count
        count_base = (
            select(GroupMember.id)
            .join(User, GroupMember.user_id == User.id)
            .where(GroupMember.group_id == group_id)
        )
        if query_str:
            count_base = count_base.where(
                User.email.ilike(f"%{query_str}%")
                | User.username.ilike(f"%{query_str}%")
                | User.full_name.ilike(f"%{query_str}%")
            )
        count_query = select(func.count()).select_from(count_base.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(User.username)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        members = [(row[0], row[1]) for row in result.all()]

        return members, total

    async def get_user_groups(
        self,
        user_id: UUID,
        organization_id: UUID | None = None,
    ) -> list[UUID]:
        """
        Get group IDs user belongs to.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID | None
            Optional organization filter.

        Returns
        -------
        list[UUID]
            List of group IDs.

        """
        query = (
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )

        if organization_id:
            query = query.join(Group, GroupMember.group_id == Group.id).where(
                Group.organization_id == organization_id
            )

        result = await self._session.execute(query)
        return list(result.scalars().all())
