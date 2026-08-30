"""Group management operations."""

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy import update as sql_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer
from uniffy.domains.groups.naming import ensure_name_available, resolve_slug
from uniffy.domains.groups.search import TeamSearchIndexer
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.people.cache import (
    invalidate_chart,
    invalidate_org_people,
    invalidate_person,
)
from uniffy.domains.people.search import sync_people_search

_ADMIN_ROLES = (OrganizationRole.OWNER, OrganizationRole.ADMIN)

_MAX_TREE_DEPTH = 64

UNSET = object()


class GroupOperations:
    """Group management operations.

    Groups are permission subjects: ``ContentMember`` rows key on
    ``subject_type=GROUP`` and ``effective_role`` resolves grants through
    group membership. Writing a membership row therefore hands the target
    every content grant the group holds, so group lifecycle gates on org
    admin, membership rows gate on org admin or that group's own ADMIN,
    and reads gate on active org membership.
    """

    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        self._session = session
        self._search_indexer = search_indexer
        self._org_ops = OrganizationOperations(session, search_indexer=search_indexer)

    @property
    def search_indexer(self) -> SearchIndexer:
        if self._search_indexer is None:
            raise RuntimeError("Search indexing is required for group mutations")
        return self._search_indexer

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
        kind: GroupKind = GroupKind.ACCESS,
        parent_group_id: UUID | None = None,
        lead_user_id: UUID | None = None,
    ) -> Group:
        await self._org_ops.require_org_admin(created_by_user_id, organization_id)

        if kind is not GroupKind.TEAM and (parent_group_id or lead_user_id):
            raise ValidationError("kind", "only a TEAM carries a parent or a lead")
        if kind is GroupKind.TEAM and is_private:
            # Team facts are org-visible everywhere (chart, mentions, search
            # metadata); a private TEAM would leak its name and roster.
            raise ValidationError("is_private", "a TEAM is always org-visible")
        if parent_group_id is not None:
            await self.require_team_parent(organization_id, parent_group_id)
        if lead_user_id is not None:
            await self.require_active_member(organization_id, lead_user_id, "lead_user_id")

        await ensure_name_available(self._session, organization_id, name)
        slug = await resolve_slug(self._session, organization_id, name)

        group = Group(
            organization_id=organization_id,
            name=name,
            slug=slug,
            created_by_user_id=created_by_user_id,
            description=description,
            is_private=is_private,
            kind=kind,
            parent_group_id=parent_group_id,
            lead_user_id=lead_user_id,
        )
        self._session.add(group)
        try:
            await self._session.flush()
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=created_by_user_id,
                action=Action.GROUP_CREATED,
                resource_type=AuditResourceType.GROUP,
                resource_id=group.id,
                details={
                    "name": name,
                    "is_private": is_private,
                    "kind": kind.value,
                },
            )
            await self._session.commit()
        except IntegrityError:
            # Concurrent create raced the pre-check; same answer, typed.
            await self._session.rollback()
            raise ValidationError(
                "name",
                f'a team or group named "{name}" already exists in this organization',
            ) from None
        except Exception:
            await self._session.rollback()
            raise
        await self._session.refresh(group)

        if kind is GroupKind.TEAM:
            await invalidate_chart(organization_id)
            await TeamSearchIndexer(self._session, self.search_indexer).index_team(group)
        return group

    async def require_team_parent(self, organization_id: UUID, parent_id: UUID) -> Group:
        parent = await self._fetch(parent_id, organization_id)
        if parent.kind is not GroupKind.TEAM:
            raise ValidationError("parent_group_id", "parent must be a TEAM")
        return parent

    async def require_active_member(self, organization_id: UUID, user_id: UUID, field: str) -> None:
        try:
            await self._org_ops.require_org_member(user_id, organization_id)
        except PermissionDeniedError as exc:
            raise ValidationError(
                field,
                "must be an active member of the organization",
            ) from exc

    async def reject_parent_cycle(
        self, organization_id: UUID, group_id: UUID, parent_id: UUID
    ) -> None:
        current: UUID | None = parent_id
        for _ in range(_MAX_TREE_DEPTH):
            if current is None:
                return
            if current == group_id:
                raise ValidationError("parent_group_id", "this parent would create a cycle")
            result = await self._session.execute(
                select(Group.parent_group_id).where(
                    Group.id == current, Group.organization_id == organization_id
                )
            )
            current = result.scalar_one_or_none()

    async def update(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
        name: str | None = None,
        description: str | None = None,
        is_private: bool | None = None,
        kind: GroupKind | None = None,
        parent_group_id: UUID | None | object = UNSET,
        lead_user_id: UUID | None | object = UNSET,
    ) -> Group:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        managed = set(group.managed_fields or [])
        if "name" in managed and name is not None and name != group.name:  # noqa: PLR2004
            raise ValidationError("name", "field is managed by the directory")
        if "kind" in managed and kind is not None and kind is not group.kind:  # noqa: PLR2004
            raise ValidationError("kind", "field is managed by the directory")

        was_team = group.kind is GroupKind.TEAM
        effective_kind = kind if kind is not None else group.kind
        effective_private = is_private if is_private is not None else group.is_private

        if effective_kind is GroupKind.TEAM and effective_private:
            raise ValidationError("is_private", "a TEAM is always org-visible")
        if effective_kind is not GroupKind.TEAM:
            if parent_group_id not in (UNSET, None) or lead_user_id not in (UNSET, None):
                raise ValidationError("kind", "only a TEAM carries a parent or a lead")

        changed_keys: list[str] = []
        if name is not None and group.name != name:
            await ensure_name_available(
                self._session, organization_id, name, exclude_group_id=group_id
            )
            group.name = name
            group.slug = await resolve_slug(
                self._session, organization_id, name, exclude_group_id=group_id
            )
            changed_keys.append("name")
        if description is not None and group.description != description:
            group.description = description
            changed_keys.append("description")
        if is_private is not None and group.is_private != is_private:
            group.is_private = is_private
            changed_keys.append("is_private")

        team_indexer = TeamSearchIndexer(self._session, self.search_indexer)
        detached_children = False
        detached_child_ids: list[UUID] = []
        if kind is not None and group.kind is not kind:
            group.kind = kind
            changed_keys.append("kind")
            if was_team and kind is not GroupKind.TEAM:
                # Demotion strips org structure: no parent, no lead, and the
                # children detach rather than dangling under a non-team.
                group.parent_group_id = None
                group.lead_user_id = None
                detached_child_ids = await team_indexer.child_team_ids(group_id)
                await self._session.execute(
                    sql_update(Group)
                    .where(Group.parent_group_id == group_id)
                    .values(parent_group_id=None)
                )
                detached_children = True

        if parent_group_id is not UNSET and not detached_children:
            new_parent = parent_group_id if parent_group_id is not None else None
            if group.parent_group_id != new_parent:
                if new_parent is not None:
                    await self.require_team_parent(organization_id, new_parent)
                    await self.reject_parent_cycle(organization_id, group_id, new_parent)
                group.parent_group_id = new_parent
                changed_keys.append("parent_group_id")

        if lead_user_id is not UNSET and not detached_children:
            new_lead = lead_user_id if lead_user_id is not None else None
            if group.lead_user_id != new_lead:
                if new_lead is not None:
                    await self.require_active_member(organization_id, new_lead, "lead_user_id")
                group.lead_user_id = new_lead
                changed_keys.append("lead_user_id")

        if changed_keys:
            await write_audit_event(
                self._session,
                organization_id=group.organization_id,
                actor_user_id=actor_user_id,
                action=Action.GROUP_UPDATED,
                resource_type=AuditResourceType.GROUP,
                resource_id=group_id,
                details={"changed_keys": changed_keys},
            )

        try:
            await self._session.commit()
        except IntegrityError:
            # Concurrent rename raced the pre-check; same answer, typed.
            await self._session.rollback()
            raise ValidationError(
                "name",
                f'a team or group named "{name}" already exists in this organization',
            ) from None
        await self._session.refresh(group)

        # Team facts are denormalized into person payloads and the chart;
        # any mutation that was or is a TEAM invalidates them org-wide.
        if changed_keys and (was_team or group.kind is GroupKind.TEAM):
            await invalidate_org_people(organization_id)
            # Members' search documents and mention chips carry the team name.
            if "name" in changed_keys or "kind" in changed_keys:  # noqa: PLR2004
                member_ids = await self._active_member_ids(group_id)
                await sync_people_search(
                    self._session,
                    self.search_indexer,
                    organization_id,
                    member_ids,
                )

            if group.kind is GroupKind.TEAM:
                await team_indexer.index_team(group)
                # Child team docs denormalize this team's name as parent_label.
                if "name" in changed_keys:  # noqa: PLR2004
                    child_ids = await team_indexer.child_team_ids(group_id)
                    await team_indexer.sync_teams(organization_id, child_ids)
            elif was_team:
                await team_indexer.remove_team(group_id, organization_id)
                await team_indexer.sync_teams(organization_id, detached_child_ids)
        return group

    async def _active_member_ids(self, group_id: UUID) -> list[UUID]:
        result = await self._session.execute(
            select(GroupMember.user_id).where(
                GroupMember.group_id == group_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

    async def delete(
        self,
        group_id: UUID,
        organization_id: UUID,
        actor_user_id: UUID,
    ) -> None:
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        group = await self._fetch(group_id, organization_id)

        # Capture members first so cached perm entries can be wiped.
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
            resource_type=AuditResourceType.GROUP,
            resource_id=group_id,
            details={"name": group.name, "member_count": len(member_user_ids)},
        )

        was_team = group.kind is GroupKind.TEAM
        team_indexer = TeamSearchIndexer(self._session, self.search_indexer)
        # The parent FK is ON DELETE SET NULL, so child teams detach at the DB
        # level; snapshot them first to clear their denormalized parent_label.
        child_team_ids = await team_indexer.child_team_ids(group_id) if was_team else []
        # The membership FK carries no ON DELETE CASCADE; remove the rows
        # explicitly or the group delete fails on any populated group.
        await self._session.execute(delete(GroupMember).where(GroupMember.group_id == group_id))
        await self._session.delete(group)
        await self._session.commit()

        if was_team:
            await invalidate_org_people(organization_id)
            await sync_people_search(
                self._session,
                self.search_indexer,
                organization_id,
                member_user_ids,
            )
            await team_indexer.remove_team(group_id, organization_id)
            await team_indexer.sync_teams(organization_id, child_team_ids)

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
        to NON-members leaks the sharing graph; a member of the group already
        knows it exists and gets their own private groups back.
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

        own_active_membership = (
            select(GroupMember.id)
            .where(
                GroupMember.group_id == Group.id,
                GroupMember.user_id == actor_user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
            .correlate(Group)
            .exists()
        )
        visibility = (Group.is_private == False) | own_active_membership  # noqa: E712

        query = select(Group, member_count).where(Group.organization_id == organization_id)

        if not include_private:
            query = query.where(visibility)

        if search:
            pattern = f"%{search}%"
            query = query.where(Group.name.ilike(pattern) | Group.description.ilike(pattern))

        count_base = select(Group.id).where(Group.organization_id == organization_id)
        if not include_private:
            count_base = count_base.where(visibility)
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

    async def _require_group_manager(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        group_id: UUID,
    ) -> None:
        """Org admins manage every group's membership; a group ADMIN manages
        only their own group's. Both ride on an active org membership."""
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
        # The target inherits the group's content grants, so they must
        # already be an active member of the same org.
        await self._org_ops.require_org_member(user_id, organization_id)

        # Idempotent against the (group_id, user_id) unique constraint: an
        # existing row is updated and reactivated instead of duplicated.
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

        await self._invalidate_team_membership(group, user_id)

        return membership

    async def _invalidate_team_membership(self, group: Group, user_id: UUID) -> None:
        """A TEAM roster change is denormalized into the member's person
        payload, the org chart, their search document and mention chips,
        plus the team's own doc (member_count)."""
        if group.kind is GroupKind.TEAM:
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
        if not membership:
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
        await self._invalidate_team_membership(group, user_id)
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
        if membership:
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
            await self._invalidate_team_membership(group, user_id)

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
        actor_membership = await self._org_ops.require_org_member(
            actor_user_id,
            organization_id,
        )
        group = await self._fetch(group_id, organization_id)

        # A private group's roster is visible to its own members and to admins.
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
        if own.scalar_one_or_none() is not None:
            return
        if actor_role in _ADMIN_ROLES:
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
