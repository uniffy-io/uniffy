"""Custom field changes require manage on the project, and a status config stays valid."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition, SystemProjectFieldId
from uniffy.domains.projects.fields import operations as field_operations
from uniffy.domains.projects.fields.operations import ProjectFieldOperations
from uniffy.domains.projects.projects import ProjectOperations

STATUS_CONFIG = {
    "options": [
        {"id": "queue", "label": "Queue", "semantic": "todo"},
        {"id": "doing", "label": "Doing", "semantic": "in_progress"},
        {"id": "shipped", "label": "Shipped", "semantic": "completed"},
    ]
}


class Harness(SimpleNamespace):
    session: MagicMock
    gate: AsyncMock
    user_id: object
    organization_id: object
    project_id: object


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Harness:
    session = MagicMock()
    session.scalar = AsyncMock(return_value=None)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    gate = AsyncMock()
    monkeypatch.setattr(ProjectOperations, "get_for_manage", gate)
    return Harness(
        session=session,
        gate=gate,
        user_id=uuid4(),
        organization_id=uuid4(),
        project_id=uuid4(),
    )


def stored_field(harness: Harness, field_id: str = "field_abc", **values) -> FieldDefinition:
    field = FieldDefinition(
        id=field_id,
        project_id=harness.project_id,
        name="Effort",
        type="number",
        is_required=False,
        is_system=values.pop("is_system", False),
        sort_order=5,
        config=values.pop("config", None),
    )
    harness.session.scalar.return_value = field
    return field


def ops(harness: Harness) -> ProjectFieldOperations:
    return ProjectFieldOperations(harness.session)


def deny(harness: Harness) -> None:
    harness.gate.side_effect = PermissionDeniedError("manage", "PROJECT")


async def test_create_checks_manage_on_the_project(harness) -> None:
    field = await ops(harness).create(
        harness.user_id, harness.organization_id, harness.project_id, name="Effort", field_type="number"
    )

    harness.gate.assert_awaited_once_with(harness.user_id, harness.organization_id, harness.project_id)
    assert field.id.startswith("field_")
    assert field.is_system is False
    harness.session.commit.assert_awaited_once()


@pytest.mark.parametrize("action", ["create", "update", "delete"])
async def test_every_change_is_refused_without_manage(harness, action) -> None:
    deny(harness)
    stored_field(harness)
    calls = {
        "create": lambda o: o.create(
            harness.user_id, harness.organization_id, harness.project_id, name="x", field_type="text"
        ),
        "update": lambda o: o.update(
            harness.user_id, harness.organization_id, harness.project_id, "field_abc", name="x"
        ),
        "delete": lambda o: o.delete(
            harness.user_id, harness.organization_id, harness.project_id, "field_abc"
        ),
    }

    with pytest.raises(PermissionDeniedError):
        await calls[action](ops(harness))

    harness.session.commit.assert_not_awaited()
    harness.session.delete.assert_not_awaited()


async def test_update_changes_only_the_given_attributes(harness) -> None:
    field = stored_field(harness)

    await ops(harness).update(
        harness.user_id, harness.organization_id, harness.project_id, "field_abc", name="Points"
    )

    assert field.name == "Points"
    assert field.sort_order == 5
    assert field.is_required is False
    assert field.config is None
    harness.session.commit.assert_awaited_once()


async def test_update_of_a_field_outside_the_project_is_not_found(harness) -> None:
    with pytest.raises(NotFoundError):
        await ops(harness).update(
            harness.user_id, harness.organization_id, harness.project_id, "field_other", name="x"
        )
    harness.session.commit.assert_not_awaited()


async def test_status_update_requires_explicit_semantics(harness) -> None:
    stored_field(harness, SystemProjectFieldId.STATUS, is_system=True, config=STATUS_CONFIG)

    with pytest.raises(ValidationError):
        await ops(harness).update(
            harness.user_id,
            harness.organization_id,
            harness.project_id,
            SystemProjectFieldId.STATUS,
            config={"options": [{"id": "queue", "label": "Queue"}]},
        )
    harness.session.commit.assert_not_awaited()


async def test_status_update_checks_removed_options_and_assigns_colors(
    monkeypatch: pytest.MonkeyPatch, harness
) -> None:
    field = stored_field(harness, SystemProjectFieldId.STATUS, is_system=True, config=STATUS_CONFIG)
    removed_check = AsyncMock()
    monkeypatch.setattr(field_operations, "ensure_removed_statuses_unused", removed_check)

    await ops(harness).update(
        harness.user_id,
        harness.organization_id,
        harness.project_id,
        SystemProjectFieldId.STATUS,
        config=STATUS_CONFIG,
    )

    removed_check.assert_awaited_once_with(
        harness.session, harness.project_id, STATUS_CONFIG, STATUS_CONFIG
    )
    assert all(option.get("color") for option in field.config["options"])


async def test_a_system_field_cannot_be_deleted(harness) -> None:
    stored_field(harness, SystemProjectFieldId.STATUS, is_system=True)

    with pytest.raises(ValidationError):
        await ops(harness).delete(
            harness.user_id, harness.organization_id, harness.project_id, SystemProjectFieldId.STATUS
        )
    harness.session.delete.assert_not_awaited()


async def test_delete_removes_a_custom_field(harness) -> None:
    field = stored_field(harness)

    await ops(harness).delete(harness.user_id, harness.organization_id, harness.project_id, "field_abc")

    harness.session.delete.assert_awaited_once_with(field)
    harness.session.commit.assert_awaited_once()
