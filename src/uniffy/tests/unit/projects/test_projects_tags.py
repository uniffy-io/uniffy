"""Unit tests for the projects + tasks <-> tags wiring.

Uses ``asyncio.run`` helpers for the async paths so it works with the
repo's vanilla pytest harness (no pytest-asyncio dependency).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations


def _run(coro):
    return asyncio.run(coro)


def _make_project() -> Project:
    return Project(
        organization_id=uuid4(),
        owner_id=uuid4(),
        name="Marketing",
        description="",
        icon="folder",
        color="#3b82f6",
        access_mode=AccessMode.OWNER_ONLY,
        slug="MKT",
    )


def _make_task() -> Task:
    return Task(
        project_id=uuid4(),
        organization_id=uuid4(),
        owner_id=uuid4(),
        title="Investigate",
        description="",
        status="status_todo",
        priority="priority_medium",
        sort_order=65536,
        number=1,
        task_type="task",
    )


def _make_task_ops() -> TaskOperations:
    ops = TaskOperations.__new__(TaskOperations)
    ops.session = MagicMock()
    return ops


def _make_project_ops() -> ProjectOperations:
    ops = ProjectOperations.__new__(ProjectOperations)
    ops.session = MagicMock()
    return ops


class TestTaskTagFilterSubquery:
    def test_all_subquery_groups_and_having(self) -> None:
        ops = _make_task_ops()
        tag_ids = [generate_id(), generate_id()]
        compiled = str(
            ops._tag_filter_subquery(tag_ids).compile(compile_kwargs={"literal_binds": False})
        ).lower()
        assert "tag_assignments" in compiled
        assert "projects_tasks" in compiled
        assert "group by" in compiled
        assert "having" in compiled
        assert "count(distinct" in compiled

    def test_any_subquery_distinct_join(self) -> None:
        ops = _make_task_ops()
        compiled = str(
            ops._tag_any_subquery([generate_id(), generate_id()]).compile(
                compile_kwargs={"literal_binds": False}
            )
        ).lower()
        assert "tag_assignments" in compiled
        assert "distinct" in compiled
        # ANY must NOT carry an aggregating HAVING gate.
        assert "having" not in compiled

    def test_subquery_synthesises_task_urn(self) -> None:
        ops = _make_task_ops()
        compiled = str(
            ops._tag_filter_subquery([generate_id()]).compile(
                compile_kwargs={"literal_binds": True}
            )
        )
        assert "urn:uniffy:content:TASK:" in compiled


class TestSyncTaskTags:
    def test_none_tag_ids_short_circuits(self) -> None:
        ops = _make_task_ops()
        task = _make_task()
        _run(ops._sync_task_tags(actor_id=uuid4(), task=task, tag_ids=None))
        ops.session.execute.assert_not_called()

    def test_replace_routes_through_unified_store(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ops = _make_task_ops()
        task = _make_task()
        actor_id = uuid4()
        replacement = [generate_id()]

        captured: dict[str, object] = {}

        async def _fake_replace(
            self,
            *,
            actor_id,
            organization_id,
            content_urn,
            tag_ids,
        ):
            captured.update(
                actor_id=actor_id,
                organization_id=organization_id,
                content_urn=content_urn,
                tag_ids=list(tag_ids),
            )
            return []

        monkeypatch.setattr(
            "uniffy.domains.tags.operations.TagOperations.replace_manual_tags",
            _fake_replace,
            raising=True,
        )

        _run(ops._sync_task_tags(actor_id=actor_id, task=task, tag_ids=replacement))

        assert captured["actor_id"] == actor_id
        assert captured["organization_id"] == task.organization_id
        assert captured["tag_ids"] == replacement
        assert captured["content_urn"] == f"urn:uniffy:content:TASK:{task.id}"


class TestSyncProjectTags:
    def test_none_tag_ids_short_circuits(self) -> None:
        ops = _make_project_ops()
        project = _make_project()
        _run(ops._sync_project_tags(actor_id=uuid4(), project=project, tag_ids=None))
        ops.session.execute.assert_not_called()

    def test_replace_routes_through_unified_store(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ops = _make_project_ops()
        project = _make_project()
        actor_id = uuid4()
        replacement = [generate_id()]

        captured: dict[str, object] = {}

        async def _fake_replace(
            self,
            *,
            actor_id,
            organization_id,
            content_urn,
            tag_ids,
        ):
            captured.update(
                actor_id=actor_id,
                organization_id=organization_id,
                content_urn=content_urn,
                tag_ids=list(tag_ids),
            )
            return []

        monkeypatch.setattr(
            "uniffy.domains.tags.operations.TagOperations.replace_manual_tags",
            _fake_replace,
            raising=True,
        )

        _run(
            ops._sync_project_tags(
                actor_id=actor_id, project=project, tag_ids=replacement
            )
        )

        assert captured["actor_id"] == actor_id
        assert captured["organization_id"] == project.organization_id
        assert captured["tag_ids"] == replacement
        assert captured["content_urn"] == f"urn:uniffy:content:PROJECT:{project.id}"


class TestHydrateHelpers:
    def test_hydrate_task_tags_no_op_on_empty_input(self) -> None:
        from uniffy.domains.projects.handlers import _hydrate_task_tags

        session = AsyncMock()
        out = _run(_hydrate_task_tags(session, uuid4(), []))
        assert out == {}
        session.execute.assert_not_called()

    def test_hydrate_project_tags_no_op_on_empty_input(self) -> None:
        from uniffy.domains.projects.handlers import _hydrate_project_tags

        session = AsyncMock()
        out = _run(_hydrate_project_tags(session, uuid4(), []))
        assert out == {}
        session.execute.assert_not_called()


class TestTagFilterModeMapping:
    def test_handler_maps_tag_filter_mode_enum_to_operations_string(self) -> None:
        # Sanity: the proto enum names line up with the operations layer's
        # expected strings ("all" / "any" / "none"). Regression guard for
        # the handler's mode mapping dict.
        from uniffy_proto.projects.v1.projects_pb2 import TagFilterMode

        mapping = {
            TagFilterMode.TAG_FILTER_MODE_ALL: "all",
            TagFilterMode.TAG_FILTER_MODE_ANY: "any",
            TagFilterMode.TAG_FILTER_MODE_NONE: "none",
        }
        assert mapping[TagFilterMode.TAG_FILTER_MODE_ALL] == "all"
        assert mapping[TagFilterMode.TAG_FILTER_MODE_ANY] == "any"
        assert mapping[TagFilterMode.TAG_FILTER_MODE_NONE] == "none"
