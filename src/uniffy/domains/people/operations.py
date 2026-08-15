"""People directory and profile operations."""

import re
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.people.cache import invalidate_chart, invalidate_person
from uniffy.domains.people.search_sync import sync_people_search

DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500

# Deeper than any real org; bounds both the manager cycle walk and the chart CTE.
MAX_CHART_DEPTH = 64
MAX_PROFILE_LINKS = 10

# Self-service covers personal fields only. Org facts (title, department,
# office, start date) are admin-set; identity (name, email) is not editable
# in this domain at all; pronouns are global on the User row.
SELF_EDITABLE_FIELDS = frozenset({
    "work_phone",
    "mobile_phone",
    "timezone",
    "bio",
    "birthday",
    "links",
})

# An admin edits org facts only; personal fields (bio, birthday, links,
# timezone) stay self-service. The directory sync is not bound by this.
ADMIN_EDITABLE_FIELDS = frozenset({
    "job_title",
    "department",
    "office_location",
    "work_phone",
    "mobile_phone",
    "start_date",
})

# Fields denormalized into the cached org chart payload.
_CHART_NODE_FIELDS = frozenset({"job_title", "department"})

# Fields denormalized into the Meili user document; mention chips read them.
_SEARCH_DOC_FIELDS = _CHART_NODE_FIELDS | frozenset({"timezone"})

_MAX_LENGTHS = {
    "job_title": 255,
    "department": 255,
    "work_phone": 50,
    "mobile_phone": 50,
    "office_location": 255,
    "timezone": 64,
    "bio": 2000,
}

_BIRTHDAY_RE = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")

DirectoryRow = tuple[OrganizationMember, User, PeopleProfile | None]


def _validate_profile_value(name: str, value: Any) -> None:
    if value is None:
        return
    if name in _MAX_LENGTHS:
        if not isinstance(value, str) or len(value) > _MAX_LENGTHS[name]:
            raise ValidationError(name, f"must be a string of at most {_MAX_LENGTHS[name]} chars")
    elif name == "birthday":  # noqa: PLR2004
        if not isinstance(value, str) or not _BIRTHDAY_RE.match(value):
            raise ValidationError(name, "must be MM-DD")
    elif name == "start_date":  # noqa: PLR2004
        if not isinstance(value, date):
            raise ValidationError(name, "must be a date")
    elif name == "links":  # noqa: PLR2004
        if not isinstance(value, list) or len(value) > MAX_PROFILE_LINKS:
            raise ValidationError(name, f"at most {MAX_PROFILE_LINKS} links")
        for link in value:
            if not isinstance(link, dict):
                raise ValidationError(name, "each link needs a label and a url")
            label, url = link.get("label"), link.get("url")
            if not isinstance(label, str) or not isinstance(url, str):
                raise ValidationError(name, "each link needs a label and a url")
            if len(label) > 100 or len(url) > 512:
                raise ValidationError(name, "link label or url too long")


class PeopleOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_profile(self, organization_id: UUID, user_id: UUID) -> PeopleProfile | None:
        """Read-only; a missing row means an empty profile. Reads must never INSERT."""
        result = await self._session.execute(
            select(PeopleProfile).where(
                PeopleProfile.organization_id == organization_id,
                PeopleProfile.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def ensure_profile(self, organization_id: UUID, user_id: UUID) -> PeopleProfile:
        """Row-creating variant for WRITE paths only."""
        profile = await self.get_profile(organization_id, user_id)
        if profile is not None:
            return profile
        profile = PeopleProfile(organization_id=organization_id, user_id=user_id)
        self._session.add(profile)
        await self._session.flush()
        return profile

    async def get_person(self, organization_id: UUID, user_id: UUID) -> DirectoryRow:
        """Raises NotFoundError unless the target is an ACTIVE org member."""
        result = await self._session.execute(
            select(OrganizationMember, User, PeopleProfile)
            .join(User, User.id == OrganizationMember.user_id)
            .outerjoin(
                PeopleProfile,
                and_(
                    PeopleProfile.organization_id == organization_id,
                    PeopleProfile.user_id == User.id,
                ),
            )
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_active.is_(True),
            )
        )
        row = result.first()
        if row is None:
            raise NotFoundError("Person", str(user_id))
        return row[0], row[1], row[2]

    async def list_directory(
        self,
        organization_id: UUID,
        *,
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        search: str | None = None,
        job_title: str | None = None,
        department: str | None = None,
        role_filter: OrganizationRole | None = None,
        team_id: UUID | None = None,
        manager_user_id: UUID | None = None,
        include_inactive: bool = False,
    ) -> tuple[list[DirectoryRow], int]:
        page = max(1, page)
        page_size = min(max(1, page_size), MAX_PAGE_SIZE)

        base_query = (
            select(OrganizationMember, User, PeopleProfile)
            .join(User, User.id == OrganizationMember.user_id)
            .outerjoin(
                PeopleProfile,
                and_(
                    PeopleProfile.organization_id == organization_id,
                    PeopleProfile.user_id == User.id,
                ),
            )
            .where(OrganizationMember.organization_id == organization_id)
        )

        if not include_inactive:
            base_query = base_query.where(OrganizationMember.is_active.is_(True))

        if search:
            # User-typed substring filter over a bounded member list; the
            # sanctioned ILIKE case, not an indexed-lookup LIKE.
            pattern = f"%{search}%"
            base_query = base_query.where(
                User.full_name.ilike(pattern)
                | User.username.ilike(pattern)
                | User.email.ilike(pattern)
                | PeopleProfile.job_title.ilike(pattern)
                | PeopleProfile.department.ilike(pattern)
            )

        if department:
            base_query = base_query.where(PeopleProfile.department == department)

        if job_title:
            base_query = base_query.where(PeopleProfile.job_title.ilike(f"%{job_title}%"))

        if role_filter is not None:
            base_query = base_query.where(OrganizationMember.role == role_filter)

        if manager_user_id is not None:
            base_query = base_query.where(PeopleProfile.manager_user_id == manager_user_id)

        if team_id is not None:
            base_query = base_query.where(
                exists(
                    select(GroupMember.id)
                    .join(Group, Group.id == GroupMember.group_id)
                    .where(
                        GroupMember.group_id == team_id,
                        GroupMember.user_id == User.id,
                        GroupMember.is_active.is_(True),
                        Group.organization_id == organization_id,
                        Group.kind == GroupKind.TEAM,
                    )
                )
            )

        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        query = base_query.order_by(func.lower(func.coalesce(User.full_name, User.username)))
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        rows = [(row[0], row[1], row[2]) for row in result.all()]
        return rows, total

    async def update_my_profile(
        self, organization_id: UUID, user_id: UUID, changes: dict[str, Any]
    ) -> PeopleProfile:
        return await self._apply_profile_changes(
            organization_id,
            actor_id=user_id,
            target_id=user_id,
            changes=changes,
            allowed_fields=SELF_EDITABLE_FIELDS,
        )

    async def update_person_profile(
        self, organization_id: UUID, actor_id: UUID, target_id: UUID, changes: dict[str, Any]
    ) -> PeopleProfile:
        await OrganizationOperations(self._session).require_org_admin(actor_id, organization_id)
        return await self._apply_profile_changes(
            organization_id,
            actor_id=actor_id,
            target_id=target_id,
            changes=changes,
            allowed_fields=ADMIN_EDITABLE_FIELDS,
        )

    async def _apply_profile_changes(
        self,
        organization_id: UUID,
        *,
        actor_id: UUID,
        target_id: UUID,
        changes: dict[str, Any],
        allowed_fields: frozenset[str],
    ) -> PeopleProfile:
        await self.get_person(organization_id, target_id)
        profile = await self.ensure_profile(organization_id, target_id)
        managed = set(profile.managed_fields or [])

        changed_keys: list[str] = []
        for name, value in changes.items():
            if name not in allowed_fields:
                raise ValidationError(name, "field is not editable here")
            if name in managed:
                raise ValidationError(name, "field is managed by the directory")
            _validate_profile_value(name, value)
            if getattr(profile, name) == value:
                continue
            # JSONB columns need a fresh object for change detection.
            setattr(profile, name, list(value) if isinstance(value, list) else value)
            changed_keys.append(name)

        if changed_keys:
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=actor_id,
                action=Action.PERSON_PROFILE_UPDATED,
                resource_type=AuditResourceType.USER,
                resource_id=target_id,
                details={"changed_keys": sorted(changed_keys)},
            )
            await self._session.commit()
            await invalidate_person(organization_id, target_id)
            if any(name in _CHART_NODE_FIELDS for name in changed_keys):
                await invalidate_chart(organization_id)
            if any(name in _SEARCH_DOC_FIELDS for name in changed_keys):
                await sync_people_search(self._session, organization_id, [target_id])
        return profile

    async def set_manager(
        self,
        organization_id: UUID,
        actor_id: UUID,
        target_id: UUID,
        manager_id: UUID | None,
    ) -> PeopleProfile:
        await OrganizationOperations(self._session).require_org_admin(actor_id, organization_id)
        await self.get_person(organization_id, target_id)

        if manager_id is not None:
            # Explicit self-check: the ancestor walk starts AT the proposed
            # manager, so self-management would otherwise pass on an empty walk.
            if manager_id == target_id:
                raise ValidationError("manager_user_id", "a person cannot manage themselves")
            await self.get_person(organization_id, manager_id)
            await self._reject_manager_cycle(organization_id, target_id, manager_id)

        profile = await self.ensure_profile(organization_id, target_id)
        if profile.manager_user_id != manager_id:
            previous = profile.manager_user_id
            profile.manager_user_id = manager_id
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=actor_id,
                action=Action.PERSON_MANAGER_CHANGED,
                resource_type=AuditResourceType.USER,
                resource_id=target_id,
                details={
                    "previous_manager_user_id": str(previous) if previous else None,
                    "manager_user_id": str(manager_id) if manager_id else None,
                },
            )
            await self._session.commit()
            await invalidate_person(organization_id, target_id)
            # Both managers' cached payloads carry direct_report_count.
            if previous is not None:
                await invalidate_person(organization_id, previous)
            if manager_id is not None:
                await invalidate_person(organization_id, manager_id)
            await invalidate_chart(organization_id)
        return profile

    async def _reject_manager_cycle(
        self, organization_id: UUID, target_id: UUID, manager_id: UUID
    ) -> None:
        """Walk up from the proposed manager; reaching the target means a cycle."""
        current: UUID | None = manager_id
        for _ in range(MAX_CHART_DEPTH):
            if current is None:
                return
            result = await self._session.execute(
                select(PeopleProfile.manager_user_id).where(
                    PeopleProfile.organization_id == organization_id,
                    PeopleProfile.user_id == current,
                )
            )
            current = result.scalar_one_or_none()
            if current == target_id:
                raise ValidationError(
                    "manager_user_id", "this manager assignment would create a cycle"
                )

    async def count_direct_reports(
        self, organization_id: UUID, user_ids: list[UUID]
    ) -> dict[UUID, int]:
        """One GROUP BY for the whole page; only ACTIVE members count as reports."""
        if not user_ids:
            return {}
        result = await self._session.execute(
            select(PeopleProfile.manager_user_id, func.count())
            .join(
                OrganizationMember,
                and_(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.user_id == PeopleProfile.user_id,
                    OrganizationMember.is_active.is_(True),
                ),
            )
            .where(
                PeopleProfile.organization_id == organization_id,
                PeopleProfile.manager_user_id.in_(user_ids),
            )
            .group_by(PeopleProfile.manager_user_id)
        )
        return {row[0]: row[1] for row in result.all()}
