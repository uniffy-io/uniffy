"""A direct template read resolves the full access policy, not only owner-only."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.scheduling.calendar.templates.operations import EventTemplateOperations


def _template(**overrides) -> EventTemplate:
    defaults = dict(
        organization_id=generate_id(),
        title="Weekly sync",
        created_by=generate_id(),
        access_mode=AccessMode.EXPLICIT_MEMBERS,
    )
    defaults.update(overrides)
    return EventTemplate(**defaults)


def _ops(template: EventTemplate, role: ContentRole | None) -> EventTemplateOperations:
    ops = EventTemplateOperations.__new__(EventTemplateOperations)
    ops.session = MagicMock()
    ops.session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=template))
    )
    ops.permission_checker = MagicMock()
    ops.permission_checker.effective_role = AsyncMock(return_value=role)
    ops._verify_org_membership = AsyncMock()
    return ops


class TestCreateAccessMode:
    async def test_named_people_mode_is_refused(self) -> None:
        ops = EventTemplateOperations.__new__(EventTemplateOperations)
        ops.session = MagicMock()
        ops._verify_org_membership = AsyncMock()

        with pytest.raises(ValidationError):
            await ops.create(
                generate_id(),
                generate_id(),
                "Weekly sync",
                access_mode=AccessMode.EXPLICIT_MEMBERS,
            )

        ops.session.add.assert_not_called()


class TestGetByIdAccess:
    async def test_member_without_a_grant_is_denied(self) -> None:
        template = _template()
        ops = _ops(template, role=None)

        with pytest.raises(PermissionDeniedError):
            await ops.get_by_id(template.id, template.organization_id, generate_id())

    async def test_granted_member_reads_it(self) -> None:
        template = _template()
        ops = _ops(template, role=ContentRole.VIEWER)

        fetched = await ops.get_by_id(template.id, template.organization_id, generate_id())

        assert fetched is template

    async def test_resolver_receives_the_template_policy(self) -> None:
        template = _template(baseline_role=None)
        ops = _ops(template, role=ContentRole.OWNER)

        await ops.get_by_id(template.id, template.organization_id, template.created_by)

        kwargs = ops.permission_checker.effective_role.await_args.kwargs
        assert kwargs["content_type"] is ContentType.CALENDAR_EVENT
        assert kwargs["content_id"] == template.id
        assert kwargs["owner_id"] == template.created_by
        assert kwargs["access_mode"] is AccessMode.EXPLICIT_MEMBERS
        assert kwargs["baseline_role"] is None
