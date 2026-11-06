"""The caller's own people-picker ranking: collaborators, then teammates, then everyone."""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import ColumnElement, Select, Uuid, any_, case, false, func, literal, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.people.collaborator_score import CollaboratorScore
from uniffy.domains.directory.collaborators.signals import TEAM_BOOST, WINDOW, decayed_score
from uniffy.domains.directory.membership import user_team_ids

DEFAULT_LIMIT = 20
MAX_LIMIT = 50
MAX_EXCLUDED = 100
MAX_QUERY_LENGTH = 100
_UUID_ARRAY = ARRAY(Uuid())


class CollaboratorTier(StrEnum):
    COLLABORATOR = "collaborator"
    TEAMMATE = "teammate"
    MEMBER = "member"


@dataclass(frozen=True, slots=True)
class CollaboratorRow:
    user: User
    membership: OrganizationMember
    tier: CollaboratorTier


def _display_key(user: User) -> str:
    return (user.full_name or user.username).lower()


def _sort_name() -> ColumnElement[str]:
    # Same fallback as `_display_key`: an empty full name sorts by username.
    return func.lower(func.coalesce(func.nullif(User.full_name, ""), User.username))


def _active_members(organization_id: UUID) -> Select[tuple[OrganizationMember, User]]:
    return (
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
        )
    )


@dataclass(frozen=True, slots=True)
class _Team:
    """The viewer's teammates, bound as one array so a large team costs one parameter."""

    ids: frozenset[UUID]

    @property
    def member(self) -> ColumnElement[bool]:
        if not self.ids:
            return false()
        return OrganizationMember.user_id == any_(literal(sorted(self.ids), _UUID_ARRAY))


async def _team(session: AsyncSession, organization_id: UUID, viewer_id: UUID) -> _Team:
    team_ids = await user_team_ids(session, organization_id, viewer_id)
    if not team_ids:
        return _Team(frozenset())
    result = await session.execute(
        select(GroupMember.user_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(
            GroupMember.group_id.in_(team_ids),
            GroupMember.is_active.is_(True),
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
        )
    )
    return _Team(frozenset(row[0] for row in result.all()) - {viewer_id})


def _boost(teammate: ColumnElement[bool]) -> ColumnElement[float]:
    return case((teammate, literal(TEAM_BOOST)), else_=0.0)


def _score_join(organization_id: UUID, viewer_id: UUID, now: datetime) -> ColumnElement[bool]:
    return (
        (CollaboratorScore.organization_id == organization_id)
        & (CollaboratorScore.user_id == viewer_id)
        & (CollaboratorScore.peer_id == OrganizationMember.user_id)
        & (CollaboratorScore.last_interaction_at > now - WINDOW)
    )


class CollaboratorReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        organization_id: UUID,
        viewer_id: UUID,
        *,
        query: str = "",
        limit: int = DEFAULT_LIMIT,
        exclude_user_ids: frozenset[UUID] = frozenset(),
        now: datetime | None = None,
    ) -> list[CollaboratorRow]:
        """Rank for `viewer_id` only; the caller has already proven active membership."""
        limit = max(1, min(limit, MAX_LIMIT))
        excluded = set(list(exclude_user_ids)[:MAX_EXCLUDED])
        now = now or datetime.now(UTC)
        team = await _team(self._session, organization_id, viewer_id)
        term = query.strip()[:MAX_QUERY_LENGTH]
        if term:
            # Typing your own name finds you; pickers that cannot take the caller exclude them.
            return await self._search(organization_id, viewer_id, term, limit, excluded, team, now)
        # Suggestions leave the caller out; clients pin a "Me" row instead.
        excluded.add(viewer_id)
        return await self._suggest(organization_id, viewer_id, limit, excluded, team, now)

    async def _suggest(
        self,
        organization_id: UUID,
        viewer_id: UUID,
        limit: int,
        excluded: set[UUID],
        team: _Team,
        now: datetime,
    ) -> list[CollaboratorRow]:
        rows: list[CollaboratorRow] = []
        seen = set(excluded)

        ranked = await self._session.execute(
            _active_members(organization_id)
            .join(CollaboratorScore, _score_join(organization_id, viewer_id, now))
            .where(OrganizationMember.user_id.not_in(seen))
            .order_by((decayed_score(now) + _boost(team.member)).desc(), _sort_name(), User.id)
            .limit(limit)
        )
        for membership, user in ranked.all():
            rows.append(CollaboratorRow(user, membership, CollaboratorTier.COLLABORATOR))
            seen.add(user.id)

        if len(rows) < limit and team.ids - seen:
            teammates = await self._session.execute(
                _active_members(organization_id)
                .where(team.member, OrganizationMember.user_id.not_in(seen))
                .order_by(_sort_name(), User.id)
                .limit(limit - len(rows))
            )
            for membership, user in teammates.all():
                rows.append(CollaboratorRow(user, membership, CollaboratorTier.TEAMMATE))
                seen.add(user.id)

        if len(rows) < limit:
            rest = await self._session.execute(
                _active_members(organization_id)
                .where(OrganizationMember.user_id.not_in(seen))
                .order_by(_sort_name(), User.id)
                .limit(limit - len(rows))
            )
            rows.extend(
                CollaboratorRow(user, membership, CollaboratorTier.MEMBER)
                for membership, user in rest.all()
            )
        return rows

    async def _search(
        self,
        organization_id: UUID,
        viewer_id: UUID,
        term: str,
        limit: int,
        excluded: set[UUID],
        team: _Team,
        now: datetime,
    ) -> list[CollaboratorRow]:
        """Prefix matches first, then in the same tier order as suggestions, then by name."""
        columns = (User.full_name, User.username, User.email)
        matches = or_(*(column.icontains(term, autoescape=True) for column in columns))
        starts = or_(
            *(column.istartswith(term, autoescape=True) for column in columns),
            User.full_name.icontains(f" {term}", autoescape=True),
        )
        starts_rank = case((starts, 0), else_=1).label("starts_rank")
        is_teammate = team.member.label("is_teammate")

        # Two bounded reads: the caller's scored matches (capped by the nightly prune), then the
        # top `limit` unscored ones, which tie on score so no more of them can ever be needed.
        scored = await self._session.execute(
            _active_members(organization_id)
            .join(CollaboratorScore, _score_join(organization_id, viewer_id, now))
            .add_columns(starts_rank, is_teammate, decayed_score(now).label("score"))
            .where(OrganizationMember.user_id.not_in(excluded), matches)
        )
        candidates: list[tuple[tuple[int, int, float, str, UUID], CollaboratorRow]] = []
        scored_ids: set[UUID] = set()
        for membership, user, rank, on_team, score in scored.all():
            scored_ids.add(user.id)
            boost = TEAM_BOOST if on_team else 0.0
            row = CollaboratorRow(user, membership, CollaboratorTier.COLLABORATOR)
            candidates.append(((rank, 0, -(score + boost), _display_key(user), user.id), row))

        rest = await self._session.execute(
            _active_members(organization_id)
            .add_columns(starts_rank, is_teammate)
            .where(OrganizationMember.user_id.not_in(excluded | scored_ids), matches)
            .order_by(starts_rank, _boost(team.member).desc(), _sort_name(), User.id)
            .limit(limit)
        )
        for membership, user, rank, on_team in rest.all():
            tier = CollaboratorTier.TEAMMATE if on_team else CollaboratorTier.MEMBER
            row = CollaboratorRow(user, membership, tier)
            candidates.append(((rank, 1 if on_team else 2, 0.0, _display_key(user), user.id), row))

        candidates.sort(key=lambda item: item[0])
        return [row for _, row in candidates[:limit]]
