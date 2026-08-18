"""Authorization guards on group operations."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupRole
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.groups.operations import GroupOperations

ORG = generate_id()
OTHER_ORG = generate_id()
ACTOR = generate_id()
TARGET = generate_id()


def _group(organization_id=ORG, is_private: bool = False) -> Group:
    return Group(
        id=generate_id(),
        organization_id=organization_id,
        name="Engineering",
        slug="engineering",
        created_by_user_id=generate_id(),
        description="",
        is_private=is_private,
    )


def _membership(role: OrganizationRole, is_active: bool = True) -> OrganizationMember:
    return OrganizationMember(
        user_id=ACTOR,
        organization_id=ORG,
        role=role,
        is_active=is_active,
    )


def _session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.execute = AsyncMock(
        return_value=MagicMock(
            scalar_one_or_none=lambda: None,
            all=lambda: [],
            first=lambda: None,
            scalar=lambda: 0,
            scalars=lambda: MagicMock(all=lambda: []),
        )
    )
    return session


def _as(role: OrganizationRole | None, is_active: bool = True):
    row = None if role is None or not is_active else _membership(role)
    return patch(
        "uniffy.domains.organizations.operations.get_active_membership",
        AsyncMock(return_value=row),
    )


_MUTATIONS = [
    pytest.param(
        lambda ops, g: ops.create(organization_id=ORG, name="X", created_by_user_id=ACTOR),
        id="create",
    ),
    pytest.param(
        lambda ops, g: ops.update(group_id=g.id, organization_id=ORG, actor_user_id=ACTOR, name="X"),
        id="update",
    ),
    pytest.param(
        lambda ops, g: ops.delete(g.id, ORG, actor_user_id=ACTOR),
        id="delete",
    ),
    pytest.param(
        lambda ops, g: ops.add_member(
            group_id=g.id, organization_id=ORG, user_id=TARGET, actor_user_id=ACTOR
        ),
        id="add_member",
    ),
    pytest.param(
        lambda ops, g: ops.update_member_role(
            group_id=g.id,
            organization_id=ORG,
            user_id=TARGET,
            role=GroupRole.ADMIN,
            actor_user_id=ACTOR,
        ),
        id="update_member_role",
    ),
    pytest.param(
        lambda ops, g: ops.remove_member(
            group_id=g.id, organization_id=ORG, user_id=TARGET, actor_user_id=ACTOR
        ),
        id="remove_member",
    ),
]

_READS = [
    pytest.param(
        lambda ops, g: ops.get_by_id(g.id, ORG, ACTOR),
        id="get_by_id",
    ),
    pytest.param(
        lambda ops, g: ops.list_in_organization(organization_id=ORG, actor_user_id=ACTOR),
        id="list_in_organization",
    ),
    pytest.param(
        lambda ops, g: ops.list_members(group_id=g.id, organization_id=ORG, actor_user_id=ACTOR),
        id="list_members",
    ),
    pytest.param(
        lambda ops, g: ops.get_member(
            group_id=g.id, organization_id=ORG, user_id=TARGET, actor_user_id=ACTOR
        ),
        id="get_member",
    ),
    pytest.param(
        lambda ops, g: ops.get_user_groups(ACTOR, ORG, ACTOR),
        id="get_user_groups_self",
    ),
]


@pytest.mark.parametrize("call", _MUTATIONS)
async def test_mutations_require_org_admin(call) -> None:
    ops = GroupOperations(_session())
    group = _group()
    with (
        _as(OrganizationRole.MEMBER),
        patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
        pytest.raises(PermissionDeniedError),
    ):
        await call(ops, group)


@pytest.mark.parametrize("call", _MUTATIONS)
async def test_mutations_reject_non_members(call) -> None:
    ops = GroupOperations(_session())
    group = _group()
    with (
        _as(None),
        patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
        pytest.raises(PermissionDeniedError),
    ):
        await call(ops, group)


@pytest.mark.parametrize("call", _MUTATIONS)
async def test_mutations_reject_deactivated_admins(call) -> None:
    ops = GroupOperations(_session())
    group = _group()
    with (
        _as(OrganizationRole.ADMIN, is_active=False),
        patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
        pytest.raises(PermissionDeniedError),
    ):
        await call(ops, group)


@pytest.mark.parametrize("call", _READS)
async def test_reads_reject_non_members(call) -> None:
    ops = GroupOperations(_session())
    group = _group()
    with (
        _as(None),
        patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
        pytest.raises(PermissionDeniedError),
    ):
        await call(ops, group)


@pytest.mark.parametrize("call", _READS)
async def test_reads_reject_deactivated_members(call) -> None:
    ops = GroupOperations(_session())
    group = _group()
    with (
        _as(OrganizationRole.MEMBER, is_active=False),
        patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
        pytest.raises(PermissionDeniedError),
    ):
        await call(ops, group)


async def test_include_private_requires_admin() -> None:
    ops = GroupOperations(_session())
    with _as(OrganizationRole.MEMBER), pytest.raises(PermissionDeniedError):
        await ops.list_in_organization(
            organization_id=ORG, actor_user_id=ACTOR, include_private=True
        )


async def test_another_users_groups_require_admin() -> None:
    ops = GroupOperations(_session())
    with _as(OrganizationRole.MEMBER), pytest.raises(PermissionDeniedError):
        await ops.get_user_groups(TARGET, ORG, ACTOR)


async def test_add_member_rejects_target_outside_the_org() -> None:
    """The target inherits the group's content grants, so a non-member
    target would gain access to a tenant they do not belong to.
    """
    ops = GroupOperations(_session())
    group = _group()

    async def membership_for(_session, user_id, org_id):
        return _membership(OrganizationRole.ADMIN) if user_id == ACTOR else None

    with (
        patch(
            "uniffy.domains.organizations.operations.get_active_membership",
            AsyncMock(side_effect=membership_for),
        ),
        patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
        pytest.raises(PermissionDeniedError),
    ):
        await ops.add_member(
            group_id=group.id,
            organization_id=ORG,
            user_id=TARGET,
            actor_user_id=ACTOR,
        )


async def test_fetch_scopes_by_organization() -> None:
    """A group id from another tenant must not resolve."""
    from uniffy.core.errors import NotFoundError

    session = _session()
    ops = GroupOperations(session)

    with _as(OrganizationRole.ADMIN), pytest.raises(NotFoundError):
        await ops.get_by_id(generate_id(), ORG, ACTOR)
