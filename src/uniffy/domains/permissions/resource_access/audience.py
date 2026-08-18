from collections import defaultdict
from collections.abc import Collection
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_content_role,
)
from uniffy.core.auth.permissions.roles import ROLE_ORDINAL
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.permissions.resource_access.audience_targets import filter_resource_audience
from uniffy.domains.permissions.resource_access.types import ResourceKey


class ResourceAudienceResolver:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def filter_standard(
        self,
        *,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        owner_id: UUID,
        access_mode: AccessMode | None,
        baseline_role: ContentRole | None,
        candidate_user_ids: Collection[UUID],
    ) -> list[UUID]:
        candidates = tuple(dict.fromkeys(candidate_user_ids))
        if not candidates:
            return []
        active_roles = await self.active_roles(organization_id, candidates)
        if not active_roles:
            return []
        actor_ids = set(active_roles)
        group_memberships = await self.group_memberships(organization_id, actor_ids)
        group_ids = {
            group_id for memberships in group_memberships.values() for group_id in memberships
        }

        subject_predicates = [
            and_(
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id.in_(actor_ids),
            )
        ]
        if group_ids:
            subject_predicates.append(
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(group_ids),
                )
            )
        grants = (
            await self.session.execute(
                select(
                    ContentMember.subject_type,
                    ContentMember.subject_id,
                    ContentMember.role,
                ).where(
                    ContentMember.organization_id == organization_id,
                    ContentMember.content_type == content_type,
                    ContentMember.content_id == content_id,
                    or_(*subject_predicates),
                    or_(
                        ContentMember.expires_at.is_(None),
                        ContentMember.expires_at > datetime.now(UTC),
                    ),
                )
            )
        ).all()
        roles_by_user: dict[UUID, list[ContentRole]] = defaultdict(list)
        members_by_group: dict[UUID, set[UUID]] = defaultdict(set)
        for user_id, memberships in group_memberships.items():
            for group_id in memberships:
                members_by_group[group_id].add(user_id)
        for subject_type, subject_id, role in grants:
            if subject_type == SubjectType.USER:
                roles_by_user[subject_id].append(role)
            else:
                for user_id in members_by_group.get(subject_id, ()):
                    roles_by_user[user_id].append(role)

        default_mode, default_baseline = await resolve_content_defaults(
            self.session,
            organization_id,
            content_type,
        )
        allowed: list[UUID] = []
        for user_id in candidates:
            if user_id not in active_roles:
                continue
            roles = roles_by_user.get(user_id, ())
            blocked = ContentRole.BLOCKED in roles
            granted_role = max(
                (role for role in roles if role != ContentRole.BLOCKED),
                key=lambda role: ROLE_ORDINAL[role],
                default=None,
            )
            role = resolve_effective_content_role(
                user_id=user_id,
                owner_id=owner_id,
                is_active_member=True,
                support_role=None,
                blocked=blocked,
                granted_role=granted_role,
                raw_access_mode=access_mode,
                raw_baseline_role=baseline_role,
                org_default_access_mode=default_mode,
                org_default_baseline_role=default_baseline,
            )
            if role is not None:
                allowed.append(user_id)
        return allowed

    async def filter_resource(
        self,
        *,
        organization_id: UUID,
        key: ResourceKey,
        candidate_user_ids: Collection[UUID],
    ) -> list[UUID]:
        return await filter_resource_audience(
            self,
            organization_id=organization_id,
            key=key,
            candidate_user_ids=candidate_user_ids,
        )

    async def filter_chat(
        self,
        *,
        organization_id: UUID,
        channel: ChatChannel,
        candidate_user_ids: Collection[UUID],
    ) -> list[UUID]:
        return await ChatAccessChecker(self.session).filter_viewers(
            organization_id,
            channel,
            candidate_user_ids,
        )

    async def standard_audience(
        self,
        *,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        owner_id: UUID,
        access_mode: AccessMode | None,
        baseline_role: ContentRole | None,
    ) -> list[UUID]:
        grant_rows = (
            await self.session.execute(
                select(ContentMember.subject_type, ContentMember.subject_id).where(
                    ContentMember.organization_id == organization_id,
                    ContentMember.content_type == content_type,
                    ContentMember.content_id == content_id,
                    or_(
                        ContentMember.expires_at.is_(None),
                        ContentMember.expires_at > datetime.now(UTC),
                    ),
                )
            )
        ).all()
        candidates = {owner_id}
        group_ids = set()
        for subject_type, subject_id in grant_rows:
            if subject_type == SubjectType.USER:
                candidates.add(subject_id)
            else:
                group_ids.add(subject_id)
        if group_ids:
            candidates.update(
                (
                    await self.session.execute(
                        select(GroupMember.user_id)
                        .join(Group, Group.id == GroupMember.group_id)
                        .where(
                            GroupMember.group_id.in_(group_ids),
                            GroupMember.is_active.is_(True),
                            Group.organization_id == organization_id,
                        )
                    )
                ).scalars()
            )
        return await self.filter_standard(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=owner_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
            candidate_user_ids=candidates,
        )

    async def active_roles(
        self,
        organization_id: UUID,
        user_ids: Collection[UUID],
    ) -> dict[UUID, OrganizationRole]:
        if not user_ids:
            return {}
        rows = (
            await self.session.execute(
                select(OrganizationMember.user_id, OrganizationMember.role)
                .join(User, User.id == OrganizationMember.user_id)
                .join(Organization, Organization.id == OrganizationMember.organization_id)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.user_id.in_(user_ids),
                    OrganizationMember.is_active.is_(True),
                    User.is_active.is_(True),
                    Organization.deleted_at.is_(None),
                    Organization.is_suspended.is_(False),
                )
            )
        ).all()
        return {user_id: role for user_id, role in rows}

    async def group_memberships(
        self,
        organization_id: UUID,
        user_ids: Collection[UUID],
    ) -> dict[UUID, set[UUID]]:
        rows = (
            await self.session.execute(
                select(GroupMember.user_id, GroupMember.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(
                    GroupMember.user_id.in_(user_ids),
                    GroupMember.is_active.is_(True),
                    Group.organization_id == organization_id,
                )
            )
        ).all()
        result: dict[UUID, set[UUID]] = defaultdict(set)
        for user_id, group_id in rows:
            result[user_id].add(group_id)
        return result

    async def blocked_users(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        user_ids: Collection[UUID],
    ) -> set[UUID]:
        candidates = set(user_ids)
        if not candidates:
            return set()
        group_memberships = await self.group_memberships(organization_id, candidates)
        group_ids = {
            group_id for memberships in group_memberships.values() for group_id in memberships
        }
        predicates = [
            and_(
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id.in_(candidates),
            )
        ]
        if group_ids:
            predicates.append(
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(group_ids),
                )
            )
        rows = (
            await self.session.execute(
                select(ContentMember.subject_type, ContentMember.subject_id).where(
                    ContentMember.organization_id == organization_id,
                    ContentMember.content_type == content_type,
                    ContentMember.content_id == content_id,
                    ContentMember.role == ContentRole.BLOCKED,
                    or_(*predicates),
                    or_(
                        ContentMember.expires_at.is_(None),
                        ContentMember.expires_at > datetime.now(UTC),
                    ),
                )
            )
        ).all()
        blocked: set[UUID] = set()
        members_by_group: dict[UUID, set[UUID]] = defaultdict(set)
        for user_id, memberships in group_memberships.items():
            for group_id in memberships:
                members_by_group[group_id].add(user_id)
        for subject_type, subject_id in rows:
            if subject_type == SubjectType.USER:
                blocked.add(subject_id)
            else:
                blocked.update(members_by_group.get(subject_id, ()))
        return blocked
