from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.agents.runtime.workspace_prompt import WORKSPACE_PROMPT
from uniffy.domains.agents.tools.builtin.content_space import (
    parse_creation_space,
    space_for_access_mode,
)
from uniffy.domains.agents.tools.builtin.files import (
    _execute_create_folder as execute_create_file_folder,
)
from uniffy.domains.agents.tools.builtin.files import create_folder as create_file_folder
from uniffy.domains.agents.tools.builtin.images import (
    _execute_generate_image,
    build_image_tool_schema,
    generate_image,
)
from uniffy.domains.agents.tools.builtin.notes import (
    _execute_create_folder as execute_create_note_folder,
)
from uniffy.domains.agents.tools.builtin.notes import (
    _execute_create_note,
    create_note,
)
from uniffy.domains.agents.tools.builtin.notes import (
    create_folder as create_note_folder,
)
from uniffy.domains.agents.tools.builtin.projects import (
    _execute_create_project,
    create_project,
)
from uniffy.domains.agents.tools.definitions import ToolContext


@pytest.mark.parametrize(
    ("space", "expected"),
    [
        ("personal", AccessMode.OWNER_ONLY),
        ("organization", AccessMode.OPEN_TO_ORG),
    ],
)
def test_creation_space_maps_to_explicit_access_mode(
    space: str,
    expected: AccessMode,
) -> None:
    access_mode, error = parse_creation_space({"space": space})

    assert error is None
    assert access_mode == expected


def test_missing_creation_space_defaults_to_owner_only() -> None:
    access_mode, error = parse_creation_space({})

    assert access_mode == AccessMode.OWNER_ONLY
    assert error is None


def test_explicit_members_space_is_based_on_ownership() -> None:
    user_id = generate_id()

    assert (
        space_for_access_mode(
            AccessMode.EXPLICIT_MEMBERS,
            None,
            owner_id=user_id,
            current_user_id=user_id,
        )
        == "personal"
    )
    assert (
        space_for_access_mode(
            AccessMode.EXPLICIT_MEMBERS,
            None,
            owner_id=generate_id(),
            current_user_id=user_id,
        )
        == "shared"
    )


@pytest.mark.parametrize(
    "tool",
    [create_note, create_note_folder, create_file_folder, create_project, generate_image],
)
def test_top_level_creation_tools_keep_semantic_space_optional(tool) -> None:
    schema = tool.parameter_schema

    assert "space" not in schema["required"]
    assert schema["properties"]["space"]["enum"] == [
        "personal",
        "organization",
    ]


def test_dynamic_image_schema_keeps_space_optional() -> None:
    schema = build_image_tool_schema("openai", "gpt-image-1")

    assert "space" not in schema["required"]
    assert schema["properties"]["space"]["enum"] == [
        "personal",
        "organization",
    ]


def test_workspace_prompt_defaults_ambiguous_creation_to_personal() -> None:
    assert "default to Personal and proceed without asking" in WORKSPACE_PROMPT
    assert "Organization is opt-in" in WORKSPACE_PROMPT
    assert "Shared With Me is not a creation destination" in WORKSPACE_PROMPT


async def test_missing_space_creates_an_owner_only_note() -> None:
    ctx = SimpleNamespace(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )
    ops = MagicMock()
    ops.create = AsyncMock(return_value=SimpleNamespace(id=generate_id(), title="Ambiguous"))

    with patch("uniffy.domains.notes.operations.NoteOperations", return_value=ops):
        result = await _execute_create_note(ctx, {"title": "Ambiguous"})

    assert result.success
    assert ops.create.await_args.kwargs["access_mode"] == AccessMode.OWNER_ONLY
    assert "in Personal" in result.data


@pytest.mark.parametrize(
    ("space", "expected"),
    [
        ("personal", AccessMode.OWNER_ONLY),
        ("organization", AccessMode.OPEN_TO_ORG),
    ],
)
async def test_note_creation_passes_explicit_access_mode(
    space: str,
    expected: AccessMode,
) -> None:
    ctx = SimpleNamespace(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )
    note = SimpleNamespace(id=generate_id(), title="Trip summary")
    ops = MagicMock()
    ops.create = AsyncMock(return_value=note)

    with patch("uniffy.domains.notes.operations.NoteOperations", return_value=ops):
        result = await _execute_create_note(
            ctx,
            {"title": note.title, "content": "Body", "space": space},
        )

    assert result.success
    assert ops.create.await_args.kwargs["access_mode"] == expected


async def test_note_without_space_inherits_organization_parent() -> None:
    ctx = SimpleNamespace(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )
    folder_id = generate_id()
    ops = MagicMock()
    ops.get_by_id = AsyncMock(
        return_value=SimpleNamespace(
            access_mode=AccessMode.OPEN_TO_ORG,
            owner_id=ctx.user_id,
        )
    )
    ops.create = AsyncMock(return_value=SimpleNamespace(id=generate_id(), title="Team note"))

    with (
        patch("uniffy.domains.notes.operations.NoteOperations", return_value=ops),
        patch(
            "uniffy.domains.agents.tools.builtin.notes._resolve_folder_arg",
            new=AsyncMock(return_value=(folder_id, None)),
        ),
    ):
        result = await _execute_create_note(
            ctx,
            {"title": "Team note", "folder_id": str(folder_id)},
        )

    assert result.success
    assert ops.create.await_args.kwargs["access_mode"] == AccessMode.OPEN_TO_ORG
    assert "in Organization" in result.data


async def test_explicit_space_conflict_with_parent_refuses_creation() -> None:
    ctx = SimpleNamespace(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )
    folder_id = generate_id()
    ops = MagicMock()
    ops.get_by_id = AsyncMock(
        return_value=SimpleNamespace(
            access_mode=AccessMode.OPEN_TO_ORG,
            owner_id=ctx.user_id,
        )
    )
    ops.create = AsyncMock()

    with (
        patch("uniffy.domains.notes.operations.NoteOperations", return_value=ops),
        patch(
            "uniffy.domains.agents.tools.builtin.notes._resolve_folder_arg",
            new=AsyncMock(return_value=(folder_id, None)),
        ),
    ):
        result = await _execute_create_note(
            ctx,
            {
                "title": "Conflicting note",
                "folder_id": str(folder_id),
                "space": "personal",
            },
        )

    assert not result.success
    assert "folder is in Organization" in result.error
    ops.create.assert_not_awaited()


@pytest.mark.parametrize(
    ("executor", "operations_path", "result_name"),
    [
        (
            execute_create_note_folder,
            "uniffy.domains.notes.operations.NoteOperations",
            "title",
        ),
        (
            execute_create_file_folder,
            "uniffy.domains.files.operations.FolderOperations",
            "name",
        ),
    ],
)
async def test_folder_creation_passes_personal_access_mode(
    executor,
    operations_path: str,
    result_name: str,
) -> None:
    ctx = SimpleNamespace(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )
    folder = SimpleNamespace(id=generate_id(), **{result_name: "Research"})
    ops = MagicMock()
    ops.create = AsyncMock(return_value=folder)

    with patch(operations_path, return_value=ops):
        result = await executor(ctx, {"name": "Research", "space": "personal"})

    assert result.success
    assert ops.create.await_args.kwargs["access_mode"] == AccessMode.OWNER_ONLY


async def test_project_creation_passes_organization_access_mode() -> None:
    ctx = SimpleNamespace(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )
    project = SimpleNamespace(id=generate_id(), name="Launch")
    ops = MagicMock()
    ops.create = AsyncMock(return_value=project)

    with patch(
        "uniffy.domains.projects.operations.ProjectOperations",
        return_value=ops,
    ):
        result = await _execute_create_project(
            ctx,
            {"name": project.name, "space": "organization"},
        )

    assert result.success
    assert ops.create.await_args.kwargs["access_mode"] == AccessMode.OPEN_TO_ORG


@pytest.mark.parametrize(
    ("space", "expected_mode", "folder_method"),
    [
        (None, AccessMode.OWNER_ONLY, "personal"),
        ("personal", AccessMode.OWNER_ONLY, "personal"),
        ("organization", AccessMode.OPEN_TO_ORG, "organization"),
    ],
)
async def test_generated_image_file_uses_requested_space(
    space: str | None,
    expected_mode: AccessMode,
    folder_method: str,
) -> None:
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=SimpleNamespace(
            scalar_one_or_none=lambda: SimpleNamespace(
                image_model="gpt-image-1",
                image_style_prompt="",
                image_provider_key_id=None,
            )
        )
    )
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    ctx = ToolContext(
        session=session,
        user_id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
    )
    provider = SimpleNamespace(
        name="openai",
        generate_image=AsyncMock(return_value=(b"image", "image/png")),
        image_billing_size=MagicMock(return_value="1024x1024"),
    )
    provider_ops = MagicMock()
    provider_ops.get_provider_for_model = AsyncMock(return_value=provider)
    attachments = MagicMock()
    attachments.get_or_create_attachments_folder = AsyncMock(
        return_value=SimpleNamespace(id=generate_id())
    )
    attachments.get_or_create_org_attachments_folder = AsyncMock(
        return_value=SimpleNamespace(id=generate_id())
    )
    s3 = MagicMock()
    s3.upload_bytes = AsyncMock()
    indexer = MagicMock()
    indexer.index = AsyncMock()

    with (
        patch(
            "uniffy.domains.agents.providers.operations.ProviderOperations",
            return_value=provider_ops,
        ),
        patch(
            "uniffy.domains.files.attachments.operations.AttachmentOperations",
            return_value=attachments,
        ),
        patch("uniffy.core.storage.get_s3_client", return_value=s3),
        patch("uniffy.core.search.indexer.SearchIndexer", return_value=indexer),
        patch(
            "uniffy.core.valkey.rate_limit.check_image_generation_limits",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.agents.budgets.image_quota.check_image_quota",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.agents.tools.builtin.images.resolve_image_params",
            return_value={},
        ),
        patch(
            "uniffy.domains.agents.tools.builtin.images.write_audit_event",
            new=AsyncMock(),
        ),
        patch("uniffy.domains.agents.pricing.get_pricing", return_value=None),
        patch(
            "uniffy.domains.files.jobs.mime.get_jobs_for_mime_type",
            return_value=[],
        ),
        patch(
            "uniffy.domains.agents.budget_alerts.check_and_fire_alerts",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.core.valkey.publish_content_access_changed",
            new=AsyncMock(),
        ) as publish_access,
    ):
        image_args = {"prompt": "A diagram"}
        if space is not None:
            image_args["space"] = space
        result = await _execute_generate_image(ctx, image_args)

    assert result.success
    file_record = session.add.call_args_list[0].args[0]
    assert file_record.access_mode == expected_mode
    assert result.metadata["space"] == folder_method
    if folder_method == "personal":
        attachments.get_or_create_attachments_folder.assert_awaited_once()
        attachments.get_or_create_org_attachments_folder.assert_not_awaited()
        publish_access.assert_not_awaited()
    else:
        attachments.get_or_create_org_attachments_folder.assert_awaited_once()
        attachments.get_or_create_attachments_folder.assert_not_awaited()
        publish_access.assert_awaited_once()
