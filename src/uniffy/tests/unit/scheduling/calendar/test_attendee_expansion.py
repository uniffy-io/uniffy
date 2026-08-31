"""Group-attendee expansion: org-scoped, privacy-gated, active members only."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

ORG = generate_id()
ACTOR = generate_id()


def _result(scalar=None, rows=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    result.all = MagicMock(return_value=rows or [])
    return result


def _ops(execute_results) -> CalendarEventOperations:
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    ops.session.execute = AsyncMock(side_effect=execute_results)
    return ops


async def test_cross_org_group_id_is_not_expanded() -> None:
    """A group id from another tenant matches no org-scoped group and is then
    dropped by the active-membership filter instead of expanding its roster."""
    foreign_group = generate_id()
    member = generate_id()
    ops = _ops([
        _result(rows=[]),  # org-scoped probe: no group matches
        _result(rows=[(member,)]),  # active org members among the ids
    ])
    resolved, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [member, foreign_group])
    assert resolved == [member]
    assert invited_via == {}


async def test_private_group_hidden_from_non_members() -> None:
    group_id = generate_id()
    ops = _ops([
        _result(rows=[(group_id, True)]),  # probe: private group
        _result(scalar=None),  # actor is not an org admin
        _result(rows=[]),  # actor holds no membership in it
    ])
    with pytest.raises(ValidationError) as exc:
        await ops._expand_group_attendees(ACTOR, ORG, [group_id])
    assert "group not found" in str(exc.value)


async def test_private_group_expands_for_its_own_member() -> None:
    group_id = generate_id()
    a, b = generate_id(), generate_id()
    ops = _ops([
        _result(rows=[(group_id, True)]),
        _result(scalar=None),  # not an admin
        _result(rows=[(group_id,)]),  # actor is a group member
        _result(rows=[(group_id, a), (group_id, b)]),  # roster
        _result(rows=[(a,), (b,)]),  # both are active org members
    ])
    resolved, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [group_id])
    assert resolved == [a, b]
    assert invited_via == {a: group_id, b: group_id}


async def test_private_group_expands_for_org_admin() -> None:
    group_id = generate_id()
    a = generate_id()
    ops = _ops([
        _result(rows=[(group_id, True)]),
        _result(scalar=MagicMock(role=OrganizationRole.ADMIN)),
        _result(rows=[(group_id, a)]),
        _result(rows=[(a,)]),
    ])
    resolved, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [group_id])
    assert resolved == [a]
    assert invited_via == {a: group_id}


async def test_inactive_members_are_dropped() -> None:
    group_id = generate_id()
    active, inactive = generate_id(), generate_id()
    ops = _ops([
        _result(rows=[(group_id, False)]),  # public group
        _result(rows=[(group_id, active), (group_id, inactive)]),
        _result(rows=[(active,)]),  # only one active org membership
    ])
    resolved, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [group_id])
    assert resolved == [active]
    assert invited_via == {active: group_id}


async def test_direct_user_ids_pass_through_deduped() -> None:
    a, b = generate_id(), generate_id()
    ops = _ops([
        _result(rows=[]),
        _result(rows=[(a,), (b,)]),
    ])
    resolved, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [a, b, a])
    assert resolved == [a, b]
    assert invited_via == {}
