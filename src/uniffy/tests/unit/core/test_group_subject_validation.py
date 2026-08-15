"""GROUP subjects in content grants: real, org-local, and visible to the actor.

An unvalidated GROUP subject id is a cross-tenant grant primitive, and the
notification fanout for a group grant must never reach users outside the org.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.content.members import ContentMembersOperations
from uniffy.core.errors import NotFoundError
from uniffy.core.types import SubjectType, generate_id

ORG = generate_id()
ACTOR = generate_id()
GROUP = generate_id()


def _result(scalar=None, rows=None, one=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    result.one_or_none = MagicMock(return_value=one)
    result.all = MagicMock(return_value=rows or [])
    return result


def _ops(execute_results) -> ContentMembersOperations:
    ops = ContentMembersOperations.__new__(ContentMembersOperations)
    ops.session = MagicMock()
    ops.session.execute = AsyncMock(side_effect=execute_results)
    return ops


class TestRequireGroupSubject:
    async def test_missing_group_raises(self) -> None:
        ops = _ops([_result(one=None)])
        with pytest.raises(NotFoundError):
            await ops._require_group_subject(ACTOR, ORG, GROUP)

    async def test_public_group_passes(self) -> None:
        ops = _ops([_result(one=(False,))])
        await ops._require_group_subject(ACTOR, ORG, GROUP)

    async def test_private_group_passes_for_its_member(self) -> None:
        ops = _ops([_result(one=(True,)), _result(scalar=generate_id())])
        await ops._require_group_subject(ACTOR, ORG, GROUP)

    async def test_private_group_passes_for_org_admin(self) -> None:
        ops = _ops([_result(one=(True,)), _result(scalar=None), _result(scalar=generate_id())])
        await ops._require_group_subject(ACTOR, ORG, GROUP)

    async def test_private_group_reports_missing_to_outsiders(self) -> None:
        """ "Not found", never "private" - existence is the leak."""
        ops = _ops([_result(one=(True,)), _result(scalar=None), _result(scalar=None)])
        with pytest.raises(NotFoundError):
            await ops._require_group_subject(ACTOR, ORG, GROUP)


class TestAddMemberRoutesGroupsThroughTheGate:
    async def test_gate_is_awaited_and_its_verdict_final(self) -> None:
        from uniffy.core.types import AccessMode, ContentRole, ContentType

        ops = ContentMembersOperations.__new__(ContentMembersOperations)
        ops.session = MagicMock()
        content = MagicMock(access_mode=AccessMode.EXPLICIT_MEMBERS, owner_id=generate_id())
        ops._load_content = AsyncMock(return_value=content)
        ops._require_manage = AsyncMock(return_value=ContentRole.ADMIN)
        ops._resolve_effective_mode = AsyncMock(return_value=AccessMode.EXPLICIT_MEMBERS)
        ops._require_group_subject = AsyncMock(side_effect=NotFoundError("Group", str(GROUP)))

        with pytest.raises(NotFoundError):
            await ops.add_member(
                actor_user_id=ACTOR,
                organization_id=ORG,
                content_type=ContentType.NOTE,
                content_id=generate_id(),
                subject_type=SubjectType.GROUP,
                subject_id=GROUP,
                role=ContentRole.VIEWER,
            )
        ops._require_group_subject.assert_awaited_once_with(ACTOR, ORG, GROUP)


class TestNotificationTargets:
    async def test_user_subject_passes_through(self) -> None:
        ops = _ops([])
        target = generate_id()
        assert await ops._resolve_notification_targets(ORG, SubjectType.USER, target) == [target]

    async def test_group_fanout_returns_the_resolved_members(self) -> None:
        a = generate_id()
        ops = _ops([_result(rows=[(a,)])])
        targets = await ops._resolve_notification_targets(ORG, SubjectType.GROUP, GROUP)
        assert targets == [a]
