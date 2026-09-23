"""The shared view filter and sort cases, compiled to SQL and run on real rows."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb2 import (
    FilterLogic,
    SortDirection,
    TableLayout,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterNode,
    TaskFilterOperator,
    TaskFilterValue,
    TaskPseudoField,
    TaskSort,
    ViewDefinition,
)

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint, SprintStatus
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ProjectViewVisibility, ViewConfig
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.projects.operations import ProjectViewOperations
from uniffy.domains.projects.tasks.reader import TaskReader
from uniffy.domains.projects.tasks.validation import TaskValidator
from uniffy.tests.view_filter_cases import (
    CASES,
    CONTEXT,
    field_definitions,
    noon_of_today,
    sort_keys,
    symbols,
    task_filter,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _map_people(value, ids: dict[str, UUID]):
    if isinstance(value, dict):
        return {key: _map_people(inner, ids) for key, inner in value.items()}
    if isinstance(value, list):
        return [_map_people(item, ids) for item in value]
    if isinstance(value, str) and value in ids:
        return str(ids[value])
    return value


async def _seed(session: AsyncSession, env: SimpleNamespace) -> SimpleNamespace:
    ids = symbols()
    ids["user-me"], ids["user-other"] = env.admin_id, env.member_id
    names = {user["id"]: user["name"] for user in CASES["users"]}
    for symbol in ("user-me", "user-other"):
        await session.execute(
            update(User).where(User.id == ids[symbol]).values(full_name=names[symbol])
        )

    project = Project(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        access_mode=AccessMode.EXPLICIT_MEMBERS,
        name=f"Filters {generate_id().hex[:10]}",
        slug=f"FT{generate_id().hex[:8].upper()}",
    )
    session.add(project)
    await session.flush()
    session.add(
        ContentMember(
            organization_id=env.org_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.VIEWER,
            added_by_user_id=env.admin_id,
        )
    )
    session.add_all(field_definitions(project.id))
    session.add_all([
        Sprint(
            id=ids[sprint["id"]],
            project_id=project.id,
            organization_id=env.org_id,
            name=sprint["id"],
            status=SprintStatus(sprint["status"]),
            sort_order=index,
        )
        for index, sprint in enumerate(CASES["sprints"])
    ])
    session.add_all([
        Tag(id=ids[tag], organization_id=env.org_id, name=tag, slug=f"{tag}-{generate_id().hex[:6]}")
        for tag in CASES["tags"]
    ])
    await session.flush()

    tasks = []
    for row in CASES["tasks"]:
        tasks.append(
            Task(
                id=ids[row["id"]],
                project_id=project.id,
                organization_id=env.org_id,
                owner_id=ids[row["creator"]],
                title=row["title"],
                task_type=row.get("task_type", "task"),
                status=row.get("status", "status_todo"),
                priority=row.get("priority", "priority_medium"),
                parent_id=ids[row["parent"]] if "parent" in row else None,
                assignee_ids=[str(ids[user]) for user in row.get("assignees", [])],
                blocked_by_task_ids=[str(ids[task]) for task in row.get("blocked_by", [])],
                sprint_id=ids[row["sprint"]] if "sprint" in row else None,
                due_date=row.get("due_date"),
                completed_at=(
                    datetime.fromisoformat(row["completed_at"]) if "completed_at" in row else None
                ),
                is_milestone=row.get("is_milestone", False),
                number=row["number"],
                sort_order=row["sort_order"],
                field_values=_map_people(row["field_values"], ids),
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )
        )
    # Parents first, so the self-referencing foreign key holds at every insert.
    for task in sorted(tasks, key=lambda task: task.parent_id is not None):
        session.add(task)
        await session.flush()
    session.add_all([
        TagAssignment(
            tag_id=ids[tag],
            content_urn=build_content_urn(ContentType.TASK, ids[row["id"]]),
            content_type=ContentType.TASK.value,
        )
        for row in CASES["tasks"]
        for tag in row.get("tags", [])
    ])
    await session.commit()
    # updated_at follows every write; pin it back to the file's value.
    for row in CASES["tasks"]:
        await session.execute(
            update(Task)
            .where(Task.id == ids[row["id"]])
            .values(updated_at=datetime.fromisoformat(row["updated_at"]))
        )
    await session.commit()
    return SimpleNamespace(project_id=project.id, ids=ids, names={v: k for k, v in ids.items()})


async def _cleanup(session: AsyncSession, env: SimpleNamespace, seeded: SimpleNamespace) -> None:
    await session.rollback()
    task_ids = [seeded.ids[row["id"]] for row in CASES["tasks"]]
    await session.execute(
        delete(TagAssignment).where(
            TagAssignment.content_urn.in_([
                build_content_urn(ContentType.TASK, task_id) for task_id in task_ids
            ])
        )
    )
    await session.execute(delete(Tag).where(Tag.organization_id == env.org_id))
    await session.execute(update(Task).where(Task.id.in_(task_ids)).values(parent_id=None))
    await session.execute(delete(Task).where(Task.project_id == seeded.project_id))
    await session.execute(delete(Sprint).where(Sprint.project_id == seeded.project_id))
    await session.execute(delete(ViewConfig).where(ViewConfig.project_id == seeded.project_id))
    await session.execute(
        delete(FieldDefinition).where(FieldDefinition.project_id == seeded.project_id)
    )
    await session.execute(delete(Project).where(Project.id == seeded.project_id))
    await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def seeded(session, env):
    data = await _seed(session, env)
    try:
        yield data
    finally:
        await _cleanup(session, env, data)


async def _list(session, env, seeded, **kwargs) -> list[str]:
    zone = kwargs.pop("time_zone", CONTEXT["time_zone"])
    tasks, total = await TaskReader(session).list_tasks(
        user_id=kwargs.pop("user_id", env.admin_id),
        organization_id=env.org_id,
        project_id=seeded.project_id,
        time_zone=zone,
        now=noon_of_today(zone),
        **kwargs,
    )
    assert total == len(tasks)
    return [seeded.names[task.id] for task in tasks]


async def test_every_filter_case_keeps_what_the_web_keeps(session, env, seeded) -> None:
    mismatches = {}
    for case in CASES["filters"]:
        kept = await _list(
            session,
            env,
            seeded,
            task_filter=task_filter(case, seeded.ids),
            time_zone=case.get("time_zone", CONTEXT["time_zone"]),
        )
        if sorted(kept) != case["expected"]:
            mismatches[case["name"]] = sorted(kept)
    assert mismatches == {}


async def test_a_filter_on_an_unknown_field_is_refused(session, env, seeded) -> None:
    for case in CASES["rejected_filters"]:
        with pytest.raises(ValidationError, match="gone"):
            await _list(session, env, seeded, task_filter=task_filter(case, seeded.ids))


async def test_every_sort_case_orders_as_the_web_does(session, env, seeded) -> None:
    mismatches = {}
    for case in CASES["sorts"]:
        ordered = await _list(session, env, seeded, sort=sort_keys(case, seeded.ids))
        if ordered != case["expected"]:
            mismatches[case["name"]] = ordered
    assert mismatches == {}


async def test_the_current_user_in_a_shared_view_is_each_caller(session, env, seeded) -> None:
    mine = TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_AND,
        nodes=[
            TaskFilterNode(
                condition=TaskFilterCondition(
                    field=TaskFieldRef(field_id="field_assignee"),
                    operator=TaskFilterOperator.TASK_FILTER_OPERATOR_IS_ANY_OF,
                    value=TaskFilterValue(ids=TaskFilterIdSet(include_current_user=True)),
                )
            )
        ],
    )
    with patch("uniffy.domains.projects.audience.publish_content_access_changed", AsyncMock()):
        view = await ProjectViewOperations(session).create(
            env.admin_id,
            env.org_id,
            seeded.project_id,
            name="My tasks",
            definition=ViewDefinition(table=TableLayout(), filter=mine),
            visibility=ProjectViewVisibility.SHARED,
        )

    # Named by id for one caller and by name, in any case, for the other.
    for user_id, named, expected in (
        (env.admin_id, view.id, ["story"]),
        (env.member_id, "my TASKS", ["task-b"]),
    ):
        assert await _list(session, env, seeded, user_id=user_id, view=named) == expected


async def test_an_unknown_view_lists_the_views_the_caller_has(session, env, seeded) -> None:
    with pytest.raises(ValidationError, match="Views: "):
        await _list(session, env, seeded, user_id=env.member_id, view="Nowhere")


def _on(field_id: str, operator: int, ids: list[str]) -> TaskFilterNode:
    return TaskFilterNode(
        condition=TaskFilterCondition(
            field=TaskFieldRef(field_id=field_id),
            operator=operator,
            value=TaskFilterValue(ids=TaskFilterIdSet(ids=ids)),
        )
    )


async def test_a_view_on_a_deleted_field_keeps_what_the_web_keeps(session, env, seeded) -> None:
    # Once "size" is gone, "size is not s" matches nothing rather than every task, and the size
    # sort key drops, as the web evaluates the same stored view.
    either = TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_OR,
        nodes=[
            _on("size", TaskFilterOperator.TASK_FILTER_OPERATOR_IS_NOT, ["s"]),
            _on("labels", TaskFilterOperator.TASK_FILTER_OPERATOR_IS_ANY_OF, ["l-ui"]),
        ],
    )
    by_size = TaskSort(
        field=TaskFieldRef(field_id="size"), direction=SortDirection.SORT_DIRECTION_DESC
    )
    with patch("uniffy.domains.projects.audience.publish_content_access_changed", AsyncMock()):
        await ProjectViewOperations(session).create(
            env.admin_id,
            env.org_id,
            seeded.project_id,
            name="Sized",
            definition=ViewDefinition(table=TableLayout(), filter=either, sort=[by_size]),
            visibility=ProjectViewVisibility.SHARED,
        )
    await session.execute(
        delete(FieldDefinition).where(
            FieldDefinition.project_id == seeded.project_id, FieldDefinition.id == "size"
        )
    )
    await session.commit()

    assert await _list(session, env, seeded, view="sized") == ["task-a", "task-b"]
    # A caller naming the deleted field is told so instead.
    with pytest.raises(ValidationError, match="size"):
        await _list(session, env, seeded, view="sized", sort=[by_size])


async def _soft_delete(session, task_id) -> None:
    await session.execute(update(Task).where(Task.id == task_id).values(is_deleted=True))
    await session.commit()


async def test_a_subtask_of_a_deleted_task_stays_one_level_down(session, env, seeded) -> None:
    await _soft_delete(session, seeded.ids["epic-task"])
    top_level = TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_AND,
        nodes=[
            TaskFilterNode(
                condition=TaskFilterCondition(
                    field=TaskFieldRef(pseudo=TaskPseudoField.TASK_PSEUDO_FIELD_DEPTH),
                    operator=TaskFilterOperator.TASK_FILTER_OPERATOR_IS,
                    value=TaskFilterValue(number=0),
                )
            )
        ],
    )
    # The web has not loaded the deleted epic but still counts the story's parent id.
    assert await _list(session, env, seeded, task_filter=top_level) == ["loose"]


async def test_a_person_outside_the_organization_sorts_by_id(session, env, seeded) -> None:
    stranger = User(
        email=f"stranger-{generate_id().hex[:8]}@example.com",
        username=f"stranger{generate_id().hex[:8]}",
        full_name="Zed Outsider",
    )
    session.add(stranger)
    await session.flush()
    await session.execute(
        update(Task).where(Task.id == seeded.ids["loose"]).values(assignee_ids=[str(stranger.id)])
    )
    await session.commit()
    try:
        by_assignee = [TaskSort(field=TaskFieldRef(field_id="field_assignee"))]
        ordered = await _list(session, env, seeded, sort=by_assignee)
        # Not a member, so the name stays hidden and the id text, digits first, sorts ahead.
        assert ordered[:3] == ["loose", "task-b", "story"]
    finally:
        await session.execute(
            update(Task).where(Task.id == seeded.ids["loose"]).values(assignee_ids=[])
        )
        await session.execute(delete(User).where(User.id == stranger.id))
        await session.commit()


async def test_a_blocker_in_another_project_does_not_count(session, env, seeded) -> None:
    other = Project(
        organization_id=env.org_id,
        owner_id=env.member_id,
        access_mode=AccessMode.OWNER_ONLY,
        name=f"Hidden {generate_id().hex[:10]}",
        slug=f"HD{generate_id().hex[:8].upper()}",
    )
    session.add(other)
    await session.flush()
    hidden = Task(
        project_id=other.id,
        organization_id=env.org_id,
        owner_id=env.member_id,
        title="Hidden blocker",
        number=1,
    )
    session.add(hidden)
    await session.flush()
    await session.execute(
        update(Task)
        .where(Task.id == seeded.ids["story"])
        .values(blocked_by_task_ids=[str(hidden.id)])
    )
    await session.commit()
    blocked = TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_AND,
        nodes=[
            TaskFilterNode(
                condition=TaskFilterCondition(
                    field=TaskFieldRef(pseudo=TaskPseudoField.TASK_PSEUDO_FIELD_IS_BLOCKED),
                    operator=TaskFilterOperator.TASK_FILTER_OPERATOR_IS,
                    value=TaskFilterValue(flag=True),
                )
            )
        ],
    )
    try:
        # The web resolves blockers among the project's own tasks, and so does the server.
        assert await _list(session, env, seeded, task_filter=blocked) == ["task-a"]
        # Completing the story names no blocker from the other project.
        story = await session.get(Task, seeded.ids["story"])
        validator = TaskValidator(session)
        assert await validator.blockers_resolved(story, completing=True) == []
        # And no new link reaches outside the project.
        with pytest.raises(ValidationError, match="this project"):
            await validator.validate_in_project(seeded.project_id, [hidden.id], "blocked_by")
        await validator.validate_in_project(
            seeded.project_id, [seeded.ids["loose"], seeded.ids["epic-task"]], "parent_id"
        )
    finally:
        await session.execute(delete(Task).where(Task.project_id == other.id))
        await session.execute(delete(Project).where(Project.id == other.id))
        await session.commit()
