"""Group management operations."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.cache import invalidate_user as invalidate_perm_user
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.domains.organizations.operations import OrganizationOperations

_ADMIN_ROLES = (OrganizationRole.OWNER, OrganizationRole.ADMIN)


class GroupOperations:
    """Group management operations.

    Groups are permission subjects: ``ContentMember`` rows key on
    ``subject_type=GROUP`` and ``effective_role`` resolves grants through
    group membership. Writing a membership row therefore hands the target
    every content grant the group holds, so mutations here gate on org
    admin and reads gate on active org membership.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)

    async def get_by_id(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
    ) -> Group:
        await self._org_ops.require_org_member(actor_user_id, organization_id)
        return await self._fetch(group_id, organization_id)

    async def _fetch(self, group_id: UUID, organization_id: UUID) -> Group:
        """Org-scoped row load for callers that already gated."""
        result = await self._session.execute(
            select(Group).where(
                Group.id == group_id,
                Group.organization_id == organization_id,
            )
        )
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
        await self._org_ops.require_org_admin(created_by_user_id, organization_id)

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

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=created_by_user_id,
            action=Action.GROUP_CREATED,
            resource_type="GROUP",
            resource_id=group.id,
            details={"name": name, "is_private": is_private, "is_default": is_default},
        )
        await self._session.commit()
        return group

    async def update(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
        name: str | None = None,
        description: str | None = None,
        is_private: bool | None = None,
        is_default: bool | None = None,
    ) -> Group:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        changed_keys: list[str] = []
        if name is not None and group.name != name:
            group.name = name
            group.slug = name.lower().replace(" ", "-")
            changed_keys.append("name")
        if description is not None and group.description != description:
            group.description = description
            changed_keys.append("description")
        if is_private is not None and group.is_private != is_private:
            group.is_private = is_private
            changed_keys.append("is_private")
        if is_default is not None and group.is_default != is_default:
            group.is_default = is_default
            changed_keys.append("is_default")

        if changed_keys:
            await write_audit_event(
                self._session,
                organization_id=group.organization_id,
                actor_user_id=actor_user_id,
                action=Action.GROUP_UPDATED,
                resource_type="GROUP",
                resource_id=group_id,
                details={"changed_keys": changed_keys},
            )

        await self._session.commit()
        await self._session.refresh(group)
        return group

    async def delete(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
    ) -> None:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        # Capture members before cascade so cached perm entries can be wiped.
        member_ids_result = await self._session.execute(
            select(GroupMember.user_id).where(
                GroupMember.group_id == group_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        member_user_ids = [row[0] for row in member_ids_result.all()]

        await write_audit_event(
            self._session,
            organization_id=group.organization_id,
            actor_user_id=actor_user_id,
            action=Action.GROUP_DELETED,
            resource_type="GROUP",
            resource_id=group_id,
            details={"name": group.name, "member_count": len(member_user_ids)},
        )

        await self._session.delete(group)
        await self._session.commit()

        for user_id in member_user_ids:
            await invalidate_perm_user(user_id)

    async def list_in_organization(
        self,
        organization_id: UUID,
        actor_user_id: UUID,
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
        include_private: bool = False,
    ) -> tuple[list[tuple[Group, int]], int]:
        """List org groups with member counts; returns ``(rows, total)``.

        ``include_private`` is admin-only. A private group's roster is the
        subject list of whatever content it holds grants on, so exposing it
        to ordinary members leaks the sharing graph.
        """
        await self._org_ops.require_org_member(actor_user_id, organization_id)
        if include_private:
            await self._org_ops.require_org_admin(actor_user_id, organization_id)

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

        count_base = select(Group.id).where(Group.organization_id == organization_id)
        if not include_private:
            count_base = count_base.where(Group.is_private == False)  # noqa: E712
        if search:
            count_base = count_base.where(
                Group.name.ilike(f"%{search}%") | Group.description.ilike(f"%{search}%")
            )
        count_query = select(func.count()).select_from(count_base.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        query = query.order_by(Group.name)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        groups_with_counts = [(row[0], row[1] or 0) for row in result.all()]

        return groups_with_counts, total

    async def add_member(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        actor_user_id: UUID,
        role: GroupRole = GroupRole.MEMBER,
    ) -> GroupMember:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)
        # The target inherits the group's content grants, so they must
        # already be an active member of the same org.
        await self._org_ops.require_org_member(user_id, organization_id)

        membership = GroupMember(
            group_id=group_id,
            user_id=user_id,
            role=role,
        )
        self._session.add(membership)
        await self._session.commit()
        await self._session.refresh(membership)

        await write_audit_event(
            self._session,
            organization_id=group.organization_id,
            actor_user_id=actor_user_id,
            action=Action.GROUP_MEMBER_ADDED,
            resource_type="GROUP",
            resource_id=group_id,
            details={"target_user_id": str(user_id), "role": role.value},
        )
        await self._session.commit()

        await invalidate_perm_user(user_id)

        return membership

    async def update_member_role(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        role: GroupRole,
        actor_user_id: UUID,
    ) -> GroupMember:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if not membership:
            raise NotFoundError("GroupMember", f"{group_id}:{user_id}")

        previous_role = membership.role
        membership.role = role

        await write_audit_event(
            self._session,
            organization_id=group.organization_id,
            actor_user_id=actor_user_id,
            action=Action.GROUP_MEMBER_ROLE_CHANGED,
            resource_type="GROUP",
            resource_id=group_id,
            details={
                "target_user_id": str(user_id),
                "previous_role": previous_role.value,
                "role": role.value,
            },
        )

        await self._session.commit()
        await self._session.refresh(membership)
        await invalidate_perm_user(user_id)
        return membership

    async def remove_member(
        self,
        group_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        actor_user_id: UUID,
    ) -> None:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        result = await self._session.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership:
            previous_role = membership.role
            await self._session.delete(membership)

            await write_audit_event(
                self._session,
                organization_id=group.organization_id,
                actor_user_id=actor_user_id,
                action=Action.GROUP_MEMBER_REMOVED,
                resource_type="GROUP",
                resource_id=group_id,
                details={
                    "target_user_id": str(user_id),
                    "previous_role": previous_role.value,
                },
            )

            await self._session.commit()
            await invalidate_perm_user(user_id)

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
        if not row:
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
        await self._org_ops.require_org_member(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        # A private group's roster is visible to its own members and to admins.
        if group.is_private:
            await self._require_group_visibility(group_id, organization_id, actor_user_id)

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
        count_query = select(func.count()).select_from(count_base.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        query = query.order_by(User.username)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        members = [(row[0], row[1]) for row in result.all()]

        return members, total

    async def _require_group_visibility(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
    ) -> None:
        own = await self._session.execute(
            select(GroupMember.id).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == actor_user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        if own.scalar_one_or_none() is not None:
            return
        membership = await self._org_ops.get_membership(actor_user_id, organization_id)
        if membership and membership.is_active and membership.role in _ADMIN_ROLES:
            return
        raise PermissionDeniedError("Requires membership of this group")

    async def get_user_groups(
        self,
        user_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
    ) -> list[Group]:
        """Another member's group memberships are admin-only.

        The list is the inverse of the sharing graph: it says which content
        grants that user inherits, so it stays between them and an admin.
        """
        await self._org_ops.require_org_member(actor_user_id, organization_id)
        if user_id != actor_user_id:
            await self._org_ops.require_org_admin(actor_user_id, organization_id)

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
