"""Self service organization creation: policy gate, rate limits, slug rules and the create call."""

from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import ANY, AsyncMock, MagicMock, call, patch
from uuid import UUID

import pytest
from sqlalchemy.exc import IntegrityError

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.organizations.creation import (
    ORG_CREATE_LIMIT_PER_IP,
    ORG_CREATE_LIMIT_PER_USER,
    ORG_CREATE_WINDOW_SECONDS,
    create_organization_for_user,
)
from uniffy.domains.organizations.operations import OrganizationOperations

_MODULE = "uniffy.domains.organizations.creation"
_NAME = "Acme Corp"
_DERIVED_SLUG = "acme-corp"
_GIVEN_SLUG = "acme-hq"
_SLUG_FIELD = "slug"
_SLUG_TAKEN = "Slug is already in use"


def _result(value: object) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalar_one.return_value = value
    return result


def _session(user: User | None, *, slug_taken: bool = False) -> MagicMock:
    """Answers the user lookup, the slug availability check, then the owner membership read."""
    session = MagicMock()
    session.rollback = AsyncMock()
    session.membership = None

    async def execute(statement: object) -> MagicMock:
        entity = statement.column_descriptions[0]["entity"]
        if entity is User:
            return _result(user)
        if entity is Organization:
            return _result(generate_id() if slug_taken else None)
        return _result(session.membership)

    session.execute = AsyncMock(side_effect=execute)
    return session


def _user(*, is_active: bool = True) -> User:
    return User(
        id=generate_id(),
        email="founder@example.com",
        username="founder",
        is_active=is_active,
    )


@dataclass
class Collaborators:
    allowed: AsyncMock
    rate_limit: AsyncMock
    client_ip: MagicMock
    create: AsyncMock
    indexer: MagicMock


@pytest.fixture
def collaborators() -> Iterator[Collaborators]:
    allowed = AsyncMock(return_value=True)
    rate_limit = AsyncMock()
    client_ip = MagicMock(return_value=None)
    with (
        patch(f"{_MODULE}.user_can_create_organization", allowed),
        patch(f"{_MODULE}.check_rate_limit", rate_limit),
        patch(f"{_MODULE}.client_ip_for_rate_limit", client_ip),
        patch.object(OrganizationOperations, "create", autospec=True) as create,
    ):
        yield Collaborators(allowed, rate_limit, client_ip, create, MagicMock())


def _created(session: MagicMock, user_id: UUID, collaborators: Collaborators) -> None:
    """Make the mocked create return an org and leave its owner row for the follow up read."""

    async def create(_ops: OrganizationOperations, **kwargs: object) -> Organization:
        org = Organization(id=generate_id(), name=kwargs["name"], slug=kwargs["slug"])
        session.membership = OrganizationMember(
            user_id=user_id,
            organization_id=org.id,
            role=OrganizationRole.OWNER,
            source=OrganizationMemberSource.CREATED,
        )
        return org

    collaborators.create.side_effect = create


async def _create(
    session: MagicMock,
    user_id: UUID,
    collaborators: Collaborators,
    *,
    name: str = _NAME,
    slug: str | None = None,
) -> tuple[Organization, OrganizationMember]:
    return await create_organization_for_user(
        session,
        user_id=user_id,
        name=name,
        slug=slug,
        search_indexer=collaborators.indexer,
    )


class TestGates:
    async def test_denied_policy_refuses_before_any_rate_limit(
        self, collaborators: Collaborators
    ) -> None:
        user = _user()
        collaborators.allowed.return_value = False

        with pytest.raises(PermissionDeniedError, match="not allowed for this account"):
            await _create(_session(user), user.id, collaborators)

        collaborators.allowed.assert_awaited_once()
        collaborators.rate_limit.assert_not_awaited()
        collaborators.create.assert_not_awaited()

    async def test_missing_user_is_not_found(self, collaborators: Collaborators) -> None:
        with pytest.raises(NotFoundError):
            await _create(_session(None), generate_id(), collaborators)

        collaborators.rate_limit.assert_not_awaited()

    async def test_inactive_user_is_refused_before_the_policy(
        self, collaborators: Collaborators
    ) -> None:
        user = _user(is_active=False)

        with pytest.raises(PermissionDeniedError, match="cannot create organizations"):
            await _create(_session(user), user.id, collaborators)

        collaborators.allowed.assert_not_awaited()
        collaborators.rate_limit.assert_not_awaited()

    async def test_exceeded_rate_limit_stops_the_create(self, collaborators: Collaborators) -> None:
        user = _user()
        collaborators.rate_limit.side_effect = RateLimitExceededError(
            resource="organization creation (per user)",
            limit=ORG_CREATE_LIMIT_PER_USER,
            window_seconds=ORG_CREATE_WINDOW_SECONDS,
            retry_after=60,
        )

        with pytest.raises(RateLimitExceededError):
            await _create(_session(user), user.id, collaborators)

        collaborators.create.assert_not_awaited()


class TestRateLimitBuckets:
    async def test_user_and_ip_buckets(self, collaborators: Collaborators) -> None:
        user = _user()
        session = _session(user)
        _created(session, user.id, collaborators)
        collaborators.client_ip.return_value = "203.0.113.9"

        await _create(session, user.id, collaborators)

        assert collaborators.rate_limit.await_args_list == [
            call(
                key=f"rl:org:create:user:{user.id}",
                limit=ORG_CREATE_LIMIT_PER_USER,
                window_seconds=ORG_CREATE_WINDOW_SECONDS,
                resource="organization creation (per user)",
            ),
            call(
                key="rl:org:create:ip:203.0.113.9",
                limit=ORG_CREATE_LIMIT_PER_IP,
                window_seconds=ORG_CREATE_WINDOW_SECONDS,
                resource="organization creation (per ip)",
            ),
        ]

    async def test_untrusted_ip_skips_the_ip_bucket(self, collaborators: Collaborators) -> None:
        user = _user()
        session = _session(user)
        _created(session, user.id, collaborators)

        await _create(session, user.id, collaborators)

        (only,) = collaborators.rate_limit.await_args_list
        assert only.kwargs["key"] == f"rl:org:create:user:{user.id}"


class TestSlug:
    @pytest.mark.parametrize("slug", [None, "", "   "])
    async def test_slug_derives_from_the_name(
        self, slug: str | None, collaborators: Collaborators
    ) -> None:
        user = _user()
        session = _session(user)
        _created(session, user.id, collaborators)

        org, _ = await _create(session, user.id, collaborators, name=f"  {_NAME} ", slug=slug)

        assert collaborators.create.await_args.kwargs["slug"] == _DERIVED_SLUG
        assert collaborators.create.await_args.kwargs["name"] == _NAME
        assert org.slug == _DERIVED_SLUG

    async def test_given_slug_is_normalised(self, collaborators: Collaborators) -> None:
        user = _user()
        session = _session(user)
        _created(session, user.id, collaborators)

        await _create(session, user.id, collaborators, slug=f"  {_GIVEN_SLUG.upper()} ")

        assert collaborators.create.await_args.kwargs["slug"] == _GIVEN_SLUG

    async def test_malformed_slug_is_rejected(self, collaborators: Collaborators) -> None:
        user = _user()

        with pytest.raises(ValidationError) as rejected:
            await _create(_session(user), user.id, collaborators, slug="acme corp!")

        assert rejected.value.field == _SLUG_FIELD
        collaborators.create.assert_not_awaited()

    async def test_taken_slug_is_rejected(self, collaborators: Collaborators) -> None:
        user = _user()

        with pytest.raises(ValidationError) as rejected:
            await _create(_session(user, slug_taken=True), user.id, collaborators, slug="acme")

        assert rejected.value.field == _SLUG_FIELD
        assert rejected.value.message == _SLUG_TAKEN
        collaborators.create.assert_not_awaited()

    async def test_slug_claimed_during_the_create_becomes_the_slug_error(
        self, collaborators: Collaborators
    ) -> None:
        user = _user()
        session = _session(user)
        collaborators.create.side_effect = IntegrityError(
            "INSERT INTO login_organizations",
            {},
            Exception(
                'duplicate key value violates unique constraint "ix_login_organizations_slug"'
            ),
        )

        with pytest.raises(ValidationError) as rejected:
            await _create(session, user.id, collaborators, slug="acme")

        assert rejected.value.field == _SLUG_FIELD
        assert rejected.value.message == _SLUG_TAKEN
        session.rollback.assert_awaited_once()

    async def test_other_integrity_errors_propagate(self, collaborators: Collaborators) -> None:
        user = _user()
        session = _session(user)
        collaborators.create.side_effect = IntegrityError(
            "INSERT INTO login_organization_members",
            {},
            Exception('duplicate key value violates unique constraint "uq_other"'),
        )

        with pytest.raises(IntegrityError):
            await _create(session, user.id, collaborators, slug="acme")

        session.rollback.assert_awaited_once()


class TestCreate:
    async def test_creator_becomes_the_owner_of_a_free_organization_and_starts_onboarding(
        self, collaborators: Collaborators
    ) -> None:
        user = _user()
        session = _session(user)
        _created(session, user.id, collaborators)

        org, membership = await _create(session, user.id, collaborators, slug="acme")

        collaborators.create.assert_awaited_once_with(
            ANY,
            name=_NAME,
            slug="acme",
            owner_user_id=user.id,
            plan="free",
            actor_user_id=user.id,
            search_indexer=collaborators.indexer,
            owner_source=OrganizationMemberSource.CREATED,
            begin_onboarding=True,
        )
        assert membership.organization_id == org.id
        assert membership.user_id == user.id
        assert membership.role is OrganizationRole.OWNER
        session.rollback.assert_not_awaited()
