"""Assignee expansion reaches only active members of the task's organization."""

import pytest

from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.types import generate_id
from uniffy.domains.projects.tasks.notifications import TaskNotifications

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_people_and_groups_of_another_organization_are_dropped(
    session, env, second_env
) -> None:
    foreign_group = Group(
        organization_id=second_env.org_id,
        name="Elsewhere",
        slug=f"elsewhere-{generate_id().hex[:8]}",
        created_by_user_id=second_env.admin_id,
    )
    session.add(foreign_group)
    await session.flush()
    session.add(GroupMember(user_id=second_env.member_id, group_id=foreign_group.id))
    await session.commit()

    recipients = await TaskNotifications(session).expand_assignees_to_users(
        env.org_id, [env.member_id, second_env.admin_id, foreign_group.id]
    )

    assert recipients == [env.member_id]
