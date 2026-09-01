from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer
from uniffy.domains.directory.groups.projection import TeamSearchIndexer
from uniffy.domains.directory.projection import (
    invalidate_chart,
    invalidate_person,
    sync_people_search,
)
from uniffy.domains.organizations.operations import OrganizationOperations

_ADMIN_ROLES = (OrganizationRole.OWNER, OrganizationRole.ADMIN)


class GroupMemberOperations:
    """Own group membership reads and mutations."""

    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        self._session = session
        self._search_indexer = search_indexer
        self._org_ops = OrganizationOperations(session)

    @property
    def search_indexer(self) -> SearchIndexer:
        if self._search_indexer is None:
            raise RuntimeError("Search indexing is required for group membership mutations")
        return self._search_indexer

    async def _fetch(self, group_id: UUID, organization_id: UUID) -> Group:
        result = await self._session.execute(
            select(Group).where(
                Group.id == group_id,
                Group.organization_id == organization_id,
            )
        )
        group = result.scalar_one_or_none()
        if group is None:
            raise NotFoundError("Group", str(group_id))
        return group

    async def _require_group_manager(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        group_id: UUID,
    ) -> None:
        try:
            await self._org_ops.require_org_admin(actor_user_id, organization_id)
        except PermissionDeniedError:
            await self._org_ops.require_org_member(actor_user_id, organization_id)
            result = await self._session.execute(
                select(GroupMember).where(
                    GroupMember.group_id == group_id,
                    GroupMember.user_id == actor_user_id,
                    GroupMember.role == GroupRole.ADMIN,
                    GroupMember.is_active.is_(True),
                )
            )
            if result.scalar_one_or_none() is None:
                raise PermissionDeniedError("manage members", "group") from None

    async def add_member(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        actor_user_id: UUID,
        role: GroupRole = GroupRole.MEMBER,
    ) -> GroupMember:
        await self._require_group_manager(actor_user_id, organization_id, group_id)
        group = await self._fetch(group_id, organization_id)
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership is not None:
            membership.role = role
            membership.is_active = True
        else:
            membership = GroupMember(group_id=group_id, user_id=user_id, role=role)
            self._session.add(membership)
        try:
            await write_audit_event(
                self._session,
                organization_id=group.organization_id,
                actor_user_id=actor_user_id,
                action=Action.GROUP_MEMBER_ADDED,
                resource_type=AuditResourceType.GROUP,
                resource_id=group_id,
                details={"target_user_id": str(user_id), "role": role.value},
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        await self._session.refresh(membership)
        await self._refresh_team_membership(group, user_id)
        return membership

    async def _refresh_team_membership(self, group: Group, user_id: UUID) -> None:
        if group.kind is not GroupKind.TEAM:
            return
        await invalidate_person(group.organization_id, user_id)
        await invalidate_chart(group.organization_id)
        await sync_people_search(
            self._session,
            self.search_indexer,
            group.organization_id,
            [user_id],
        )
        await TeamSearchIndexer(self._session, self.search_indexer).index_team(group)

    async def update_member_role(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        role: GroupRole,
        actor_user_id: UUID,
    ) -> GroupMember:
        await self._require_group_manager(actor_user_id, organization_id, group_id)
        group = await self._fetch(group_id, organization_id)
        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership is None:
            raise NotFoundError("GroupMember", f"{group_id}:{user_id}")

        previous_role = membership.role
        membership.role = role
        await write_audit_event(
            self._session,
            organization_id=group.organization_id,
            actor_user_id=actor_user_id,
            action=Action.GROUP_MEMBER_ROLE_CHANGED,
            resource_type=AuditResourceType.GROUP,
            resource_id=group_id,
            details={
                "target_user_id": str(user_id),
                "previous_role": previous_role.value,
                "role": role.value,
            },
        )
        await self._session.commit()
        await self._session.refresh(membership)
        await self._refresh_team_membership(group, user_id)
        return membership

    async def remove_member(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        actor_user_id: UUID,
    ) -> None:
        await self._require_group_manager(actor_user_id, organization_id, group_id)
        group = await self._fetch(group_id, organization_id)
        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership is None:
            return

        previous_role = membership.role
        await self._session.delete(membership)
        await write_audit_event(
            self._session,
            organization_id=group.organization_id,
            actor_user_id=actor_user_id,
            action=Action.GROUP_MEMBER_REMOVED,
            resource_type=AuditResourceType.GROUP,
            resource_id=group_id,
            details={
                "target_user_id": str(user_id),
                "previous_role": previous_role.value,
            },
        )
        await self._session.commit()
        await self._refresh_team_membership(group, user_id)

    async def get_member(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        actor_user_id: UUID,
    ) -> tuple[GroupMember, User]:
        await self._org_ops.require_org_member(actor_user_id, organization_id)
        await self._fetch(group_id, organization_id)
        result = await self._session.execute(
            select(GroupMember, User)
            .join(User, GroupMember.user_id == User.id)
            .where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        row = result.first()
        if row is None:
            raise NotFoundError("GroupMember", f"{group_id}:{user_id}")
        return row[0], row[1]

    async def list_members(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
        page: int = 1,
        page_size: int = 20,
        role_filter: GroupRole | None = None,
    ) -> tuple[list[tuple[GroupMember, User]], int]:
        actor_membership = await self._org_ops.require_org_member(
            actor_user_id,
            organization_id,
        )
        group = await self._fetch(group_id, organization_id)
        if group.is_private:
            await self._require_group_visibility(
                group_id,
                actor_user_id,
                actor_membership.role,
            )

        query = (
            select(GroupMember, User)
            .join(User, GroupMember.user_id == User.id)
            .where(GroupMember.group_id == group_id)
        )
        if role_filter is not None:
            query = query.where(GroupMember.role == role_filter)

        count_base = select(GroupMember.id).where(GroupMember.group_id == group_id)
        if role_filter is not None:
            count_base = count_base.where(GroupMember.role == role_filter)
        total = (
            await self._session.execute(select(func.count()).select_from(count_base.subquery()))
        ).scalar() or 0

        query = query.order_by(User.username).offset((page - 1) * page_size).limit(page_size)
        result = await self._session.execute(query)
        return [(row[0], row[1]) for row in result.all()], total

    async def _require_group_visibility(
        self,
        group_id: UUID,
        actor_user_id: UUID,
        actor_role: OrganizationRole,
    ) -> None:
        own = await self._session.execute(
            select(GroupMember.id).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == actor_user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        if own.scalar_one_or_none() is not None or actor_role in _ADMIN_ROLES:
            return
        raise PermissionDeniedError("Requires membership of this group")

    async def get_user_groups(
        self,
        user_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
    ) -> list[Group]:
        await self._org_ops.require_org_member(actor_user_id, organization_id)
        if user_id != actor_user_id:
            await self._org_ops.require_org_admin(actor_user_id, organization_id)

        result = await self._session.execute(
            select(Group)
            .join(GroupMember, Group.id == GroupMember.group_id)
            .where(
                GroupMember.user_id == user_id,
                GroupMember.is_active == True,  # noqa: E712
                Group.organization_id == organization_id,
            )
            .order_by(Group.name)
        )
        return list(result.scalars().all())
