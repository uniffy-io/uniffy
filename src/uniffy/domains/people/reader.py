"""Permission-aware People reads shared by RPC handlers and agent tools."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.people.cache import get_cached_person, set_cached_person
from uniffy.domains.people.converters import build_person_payload
from uniffy.domains.people.operations import DEFAULT_PAGE_SIZE, PeopleOperations
from uniffy.domains.people.policy import load_profile_policy
from uniffy.domains.people.teams import teams_for_users

_ADMIN_ROLES = (OrganizationRole.OWNER, OrganizationRole.ADMIN)


@dataclass(frozen=True, slots=True)
class PeoplePage:
    people: list[dict[str, Any]]
    total: int
    is_admin: bool


async def load_person_payload(
    session: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
) -> dict[str, Any]:
    payload = await get_cached_person(organization_id, user_id)
    if payload is not None:
        return payload

    ops = PeopleOperations(session)
    member, user, profile = await ops.get_person(organization_id, user_id)
    counts = await ops.count_direct_reports(organization_id, [user_id])
    teams = await teams_for_users(session, organization_id, [user_id])
    payload = build_person_payload(
        member,
        user,
        profile,
        teams=teams.get(user_id, []),
        direct_report_count=counts.get(user_id, 0),
    )
    await set_cached_person(organization_id, user_id, payload)
    return payload


class PeopleReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_people(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        search: str | None = None,
        job_title: str | None = None,
        department: str | None = None,
        role_filter: OrganizationRole | None = None,
        team_id: UUID | None = None,
        manager_user_id: UUID | None = None,
        include_inactive: bool = False,
    ) -> PeoplePage:
        membership = await OrganizationOperations(self._session).require_org_member(
            actor_user_id, organization_id
        )
        is_admin = membership.role in _ADMIN_ROLES
        policy = await load_profile_policy(self._session, organization_id)
        if not policy.directory_enabled and not is_admin:
            raise PermissionDeniedError("People directory is disabled")
        if include_inactive and not is_admin:
            raise PermissionDeniedError("Listing inactive members", "directory")

        ops = PeopleOperations(self._session)
        rows, total = await ops.list_directory(
            organization_id,
            page=page,
            page_size=page_size,
            search=search,
            job_title=job_title,
            department=department,
            role_filter=role_filter,
            team_id=team_id,
            manager_user_id=manager_user_id,
            include_inactive=include_inactive,
        )
        user_ids = [user.id for _, user, _ in rows]
        counts = await ops.count_direct_reports(organization_id, user_ids)
        teams = await teams_for_users(self._session, organization_id, user_ids)
        people = [
            build_person_payload(
                member,
                user,
                profile,
                teams=teams.get(user.id, []),
                direct_report_count=counts.get(user.id, 0),
            )
            for member, user, profile in rows
        ]
        return PeoplePage(people=people, total=total, is_admin=is_admin)

    async def get_person(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        target_user_id: UUID,
    ) -> tuple[dict[str, Any], bool]:
        membership = await OrganizationOperations(self._session).require_org_member(
            actor_user_id, organization_id
        )
        payload = await load_person_payload(self._session, organization_id, target_user_id)
        return payload, membership.role in _ADMIN_ROLES
