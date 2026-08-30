"""One name namespace per org: teams and access groups may never share a name."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.groups.naming import (
    dedupe_name,
    ensure_name_available,
    resolve_slug,
    slugify,
)
from uniffy.domains.groups.operations import GroupOperations

ORG = generate_id()
ACTOR = generate_id()


def _result(scalar=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    return result


def _session(execute_results=None):
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    if execute_results is None:
        session.execute = AsyncMock(return_value=_result())
    else:
        session.execute = AsyncMock(side_effect=execute_results)
    return session


def _as_admin():
    row = OrganizationMember(
        user_id=ACTOR, organization_id=ORG, role=OrganizationRole.ADMIN, is_active=True
    )
    return patch(
        "uniffy.domains.organizations.operations.get_active_membership",
        AsyncMock(return_value=row),
    )


def _group(**overrides) -> Group:
    defaults = dict(
        id=generate_id(),
        organization_id=ORG,
        name="Engineering",
        slug="engineering",
        created_by_user_id=generate_id(),
        kind=GroupKind.ACCESS,
        managed_fields=[],
    )
    defaults.update(overrides)
    return Group(**defaults)


class TestSlugify:
    def test_regex_normalization(self) -> None:
        assert slugify("Marketing & Sales") == "marketing-sales"
        assert slugify("  Backend Team  ") == "backend-team"

    def test_empty_falls_back(self) -> None:
        assert slugify("!!!") == "group"


class TestEnsureNameAvailable:
    async def test_collision_raises_typed(self) -> None:
        session = _session([_result(scalar=generate_id())])
        with pytest.raises(ValidationError) as exc:
            await ensure_name_available(session, ORG, "Engineering")
        assert "already exists" in str(exc.value)

    async def test_free_name_passes(self) -> None:
        session = _session([_result()])
        await ensure_name_available(session, ORG, "Engineering")


class TestResolveSlug:
    async def test_suffixes_until_free(self) -> None:
        session = _session([_result(scalar=generate_id()), _result(scalar=generate_id()), _result()])
        assert await resolve_slug(session, ORG, "Engineering") == "engineering-3"


class TestDedupeName:
    async def test_suffixes_on_collision(self) -> None:
        session = _session([_result(scalar=generate_id()), _result()])
        assert await dedupe_name(session, ORG, "Engineering") == "Engineering 2"


class TestCreate:
    async def test_duplicate_name_rejected(self) -> None:
        ops = GroupOperations(_session([_result(scalar=generate_id())]))
        with _as_admin(), pytest.raises(ValidationError) as exc:
            await ops.create(organization_id=ORG, name="Engineering", created_by_user_id=ACTOR)
        assert "already exists" in str(exc.value)

    async def test_commit_race_maps_integrity_error(self) -> None:
        session = _session()
        session.commit = AsyncMock(
            side_effect=IntegrityError("INSERT", {}, Exception("uq_login_groups"))
        )
        ops = GroupOperations(session)
        with _as_admin(), pytest.raises(ValidationError) as exc:
            await ops.create(organization_id=ORG, name="Engineering", created_by_user_id=ACTOR)
        assert "already exists" in str(exc.value)
        session.rollback.assert_awaited_once()


class TestUpdate:
    async def test_rename_collision_rejected(self) -> None:
        ops = GroupOperations(_session([_result(scalar=generate_id())]))
        with (
            _as_admin(),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=_group())),
            pytest.raises(ValidationError) as exc,
        ):
            await ops.update(
                group_id=generate_id(),
                organization_id=ORG,
                actor_user_id=ACTOR,
                name="Sales",
            )
        assert "already exists" in str(exc.value)

    async def test_managed_name_rejected(self) -> None:
        group = _group(managed_fields=["name", "kind"])
        ops = GroupOperations(_session())
        with (
            _as_admin(),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            pytest.raises(ValidationError) as exc,
        ):
            await ops.update(
                group_id=group.id, organization_id=ORG, actor_user_id=ACTOR, name="Other"
            )
        assert "managed by the directory" in str(exc.value)

    async def test_managed_kind_rejected(self) -> None:
        group = _group(managed_fields=["name", "kind"])
        ops = GroupOperations(_session())
        with (
            _as_admin(),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            pytest.raises(ValidationError) as exc,
        ):
            await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                kind=GroupKind.TEAM,
            )
        assert "managed by the directory" in str(exc.value)

    async def test_managed_same_name_is_a_noop_not_an_error(self) -> None:
        group = _group(managed_fields=["name", "kind"])
        ops = GroupOperations(_session(), MagicMock())
        with _as_admin(), patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)):
            result = await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                name=group.name,
            )
        assert result is group
