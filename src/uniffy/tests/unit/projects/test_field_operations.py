"""Custom field changes require manage on the project, and a status config stays valid."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.projects.v1.projects_pb import UpdateFieldRequest

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.json_codec import loads
from uniffy.core.models.projects.field_definition import FieldDefinition, SystemProjectFieldId
from uniffy.domains.projects.fields import handlers as field_handlers
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


@pytest.mark.parametrize("config", [None, {}, {"options": [{"id": "queue", "label": "Queue"}]}])
async def test_status_update_requires_explicit_semantics(
    harness: Harness, config: dict | None
) -> None:
    stored_field(harness, SystemProjectFieldId.STATUS, is_system=True, config=STATUS_CONFIG)

    with pytest.raises(ValidationError):
        await ops(harness).update(
            harness.user_id,
            harness.organization_id,
            harness.project_id,
            SystemProjectFieldId.STATUS,
            config=config,
        )
    harness.session.commit.assert_not_awaited()


@pytest.mark.parametrize("config", [None, {}])
async def test_custom_field_config_can_be_cleared(harness: Harness, config: dict | None) -> None:
    field = stored_field(harness, config={"precision": 2})

    await ops(harness).update(
        harness.user_id, harness.organization_id, harness.project_id, field.id, config=config
    )

    assert field.config == config
    harness.session.commit.assert_awaited_once()


@pytest.mark.parametrize("field_id", ["field_abc", SystemProjectFieldId.STATUS])
@pytest.mark.parametrize("config_json", [None, "null", "{}"])
async def test_update_field_preserves_config_presence(
    monkeypatch: pytest.MonkeyPatch,
    harness: Harness,
    field_id: str,
    config_json: str | None,
) -> None:
    field = stored_field(harness, field_id, config=STATUS_CONFIG)

    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        yield harness.session

    monkeypatch.setattr(field_handlers, "open_session", open_session)
    monkeypatch.setattr(field_handlers, "current_user_id", lambda: harness.user_id)
    request = UpdateFieldRequest(
        organization_id=str(harness.organization_id),
        project_id=str(harness.project_id),
        field_id=field_id,
        **({"config_json": config_json} if config_json is not None else {}),
    )

    if field_id == SystemProjectFieldId.STATUS and config_json is not None:
        with pytest.raises(ConnectError) as caught:
            await field_handlers.FieldHandlers().update_field(request, MagicMock())
        assert caught.value.code == Code.INVALID_ARGUMENT
        assert field.config == STATUS_CONFIG
        harness.session.commit.assert_not_awaited()
    else:
        response = await field_handlers.FieldHandlers().update_field(request, MagicMock())
        expected = STATUS_CONFIG if config_json is None else loads(config_json)
        assert field.config == expected
        assert loads(response.field.config_json) == (expected or {})
        harness.session.commit.assert_awaited_once()


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
