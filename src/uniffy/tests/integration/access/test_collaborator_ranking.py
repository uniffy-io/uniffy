"""People-picker rankings stay personal, org-scoped and blind to what a viewer cannot see."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, update

from uniffy.core.errors import ValidationError
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.people.collaborator_score import CollaboratorScore
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, NotificationType, generate_id
from uniffy.domains.directory.collaborators.jobs.jobs import _prune, _shared_work
from uniffy.domains.directory.collaborators.reader import CollaboratorReader, CollaboratorTier
from uniffy.domains.directory.collaborators.recorder import record_notification_interactions
from uniffy.domains.directory.collaborators.signals import CollaboratorSignal, stage_interactions
from uniffy.domains.directory.groups.lifecycle import GroupOperations
from uniffy.domains.directory.membership import filter_active_members
from uniffy.domains.notifications.jobs.jobs import _resolve_recipients
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.projects.tasks import notifications as task_notifications
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.projects.tasks.validation import TaskValidator

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _tiers(rows) -> dict:
    return {row.user.id: row.tier for row in rows}


async def _deliver(session, event: NotificationEvent) -> int:
    """Run the same recipient resolution and recording the notification worker runs."""
    recipients = await _resolve_recipients(session, event)
    return await record_notification_interactions(session, event, recipients)


def _event(access, notification_type, actor_id, targets, **kwargs) -> NotificationEvent:
    return NotificationEvent(
        notification_type=notification_type,
        organization_id=kwargs.pop("organization_id", access.org_id),
        actor_id=actor_id,
        title="t",
        target_user_ids=targets,
        **kwargs,
    )


async def test_a_direct_message_ranks_both_people_for_each_other(session, access):
    event = _event(
        access,
        NotificationType.CHAT_DM,
        access.member_id,
        [access.peer_id],
    )
    assert await _deliver(session, event) == 2

    reader = CollaboratorReader(session)
    member_view = await reader.list(access.org_id, access.member_id)
    peer_view = await reader.list(access.org_id, access.peer_id)
    assert member_view[0].user.id == access.peer_id
    assert member_view[0].tier is CollaboratorTier.COLLABORATOR
    assert peer_view[0].user.id == access.member_id
    assert access.member_id not in _tiers(member_view)


async def test_third_party_interactions_never_reach_another_ranking(session, access):
    await _deliver(
        session,
        _event(access, NotificationType.CHAT_DM, access.peer_id, [access.admin_id]),
    )
    member_view = _tiers(await CollaboratorReader(session).list(access.org_id, access.member_id))
    assert member_view[access.peer_id] is CollaboratorTier.MEMBER
    assert member_view[access.admin_id] is CollaboratorTier.MEMBER


async def test_a_mention_in_content_the_recipient_cannot_open_records_nothing(session, access):
    event = _event(
        access,
        NotificationType.CONTENT_MENTIONED,
        access.member_id,
        [access.peer_id],
        source_urn=build_content_urn(ContentType.NOTE, access.private_note_id),
        content_type=ContentType.NOTE,
        content_id=access.private_note_id,
    )
    assert await _deliver(session, event) == 0
    member_view = _tiers(await CollaboratorReader(session).list(access.org_id, access.member_id))
    assert member_view[access.peer_id] is CollaboratorTier.MEMBER


async def test_a_mention_the_recipient_can_open_is_recorded(session, access):
    event = _event(
        access,
        NotificationType.CONTENT_MENTIONED,
        access.member_id,
        [access.peer_id],
        source_urn=build_content_urn(ContentType.NOTE, access.org_note_id),
        content_type=ContentType.NOTE,
        content_id=access.org_note_id,
    )
    assert await _deliver(session, event) == 2


async def test_agent_actions_broadcasts_and_group_grants_record_nothing(session, access):
    agent_made = _event(
        access,
        NotificationType.TASK_ASSIGNED,
        access.member_id,
        [access.peer_id],
        acting_agent_id=generate_id(),
    )
    broadcast = _event(
        access,
        NotificationType.CHAT_MENTION,
        access.member_id,
        [access.peer_id],
        metadata={"broadcast": "channel"},
    )
    group_grant = _event(
        access,
        NotificationType.PERMISSION_GRANTED,
        access.member_id,
        [access.peer_id, access.admin_id],
        source_urn=build_content_urn(ContentType.NOTE, access.org_note_id),
    )
    for event in (agent_made, broadcast, group_grant):
        assert await _deliver(session, event) == 0


async def test_scores_never_cross_organizations(session, access):
    session.add_all([
        OrganizationMember(
            user_id=access.member_id,
            organization_id=access.other_org_id,
            role=OrganizationRole.MEMBER,
        ),
        OrganizationMember(
            user_id=access.peer_id,
            organization_id=access.other_org_id,
            role=OrganizationRole.MEMBER,
        ),
    ])
    await session.commit()
    try:
        await stage_interactions(
            session,
            access.org_id,
            [(access.member_id, access.peer_id, CollaboratorSignal.DIRECT_MESSAGE)],
        )
        # A stray id from another organization cannot plant a score here.
        assert (
            await stage_interactions(
                session,
                access.org_id,
                [(access.member_id, access.outsider_id, CollaboratorSignal.PICK)],
            )
            == 0
        )
        await session.commit()

        reader = CollaboratorReader(session)
        home = _tiers(await reader.list(access.org_id, access.member_id))
        away = _tiers(await reader.list(access.other_org_id, access.member_id))
        assert home[access.peer_id] is CollaboratorTier.COLLABORATOR
        assert access.outsider_id not in home
        assert away[access.peer_id] is CollaboratorTier.MEMBER
        # The other organization's search never sees this organization's people.
        assert access.admin_id not in _tiers(
            await reader.list(access.other_org_id, access.member_id, query="tester")
        )
    finally:
        await session.execute(
            delete(OrganizationMember).where(
                OrganizationMember.organization_id == access.other_org_id,
                OrganizationMember.user_id.in_([access.member_id, access.peer_id]),
            )
        )
        await session.commit()


async def test_an_admin_ranking_is_only_their_own(session, access):
    await stage_interactions(
        session,
        access.org_id,
        [(access.member_id, access.peer_id, CollaboratorSignal.ASSIGNMENT)],
    )
    await session.commit()
    admin_view = _tiers(await CollaboratorReader(session).list(access.org_id, access.admin_id))
    assert admin_view[access.peer_id] is CollaboratorTier.MEMBER
    assert admin_view[access.member_id] is CollaboratorTier.MEMBER


async def test_deactivated_people_disappear_and_return_on_reactivation(session, access):
    now = datetime.now(UTC)
    # A score left from before the deactivation.
    session.add(
        CollaboratorScore(
            organization_id=access.org_id,
            user_id=access.member_id,
            peer_id=access.ghost_id,
            score=50.0,
            scored_at=now,
            last_interaction_at=now,
        )
    )
    await session.commit()
    reader = CollaboratorReader(session)
    assert access.ghost_id not in _tiers(await reader.list(access.org_id, access.member_id))
    assert access.ghost_id not in _tiers(
        await reader.list(access.org_id, access.member_id, query="ghost")
    )
    assert (
        await stage_interactions(
            session,
            access.org_id,
            [(access.member_id, access.ghost_id, CollaboratorSignal.PICK)],
        )
        == 0
    )

    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.ghost_id,
        )
        .values(is_active=True)
    )
    await session.commit()
    try:
        view = await reader.list(access.org_id, access.member_id)
        assert view[0].user.id == access.ghost_id
        assert view[0].tier is CollaboratorTier.COLLABORATOR
    finally:
        await session.execute(
            update(OrganizationMember)
            .where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == access.ghost_id,
            )
            .values(is_active=False)
        )
        await session.commit()


async def test_a_colleague_silent_past_the_window_ranks_below_this_week(session, access):
    now = datetime.now(UTC)
    stale = now - timedelta(days=91)
    session.add_all([
        CollaboratorScore(
            organization_id=access.org_id,
            user_id=access.owner_id,
            peer_id=access.admin_id,
            score=500.0,
            scored_at=stale,
            last_interaction_at=stale,
        ),
        CollaboratorScore(
            organization_id=access.org_id,
            user_id=access.owner_id,
            peer_id=access.peer_id,
            score=1.0,
            scored_at=now - timedelta(days=3),
            last_interaction_at=now - timedelta(days=3),
        ),
    ])
    await session.commit()
    view = await CollaboratorReader(session).list(access.org_id, access.owner_id)
    assert view[0].user.id == access.peer_id
    assert _tiers(view)[access.admin_id] is CollaboratorTier.MEMBER


async def test_teammates_fill_after_collaborators_and_skip_inactive_rows(session, access):
    # The member's team holds the ghost (deactivated) and the peer (inactive team row).
    view = _tiers(await CollaboratorReader(session).list(access.org_id, access.member_id))
    assert access.ghost_id not in view
    assert view[access.peer_id] is not CollaboratorTier.TEAMMATE


async def test_search_finds_the_caller_but_suggestions_leave_them_out(session, access):
    reader = CollaboratorReader(session)
    assert access.member_id not in _tiers(await reader.list(access.org_id, access.member_id))
    found = await reader.list(access.org_id, access.member_id, query="member")
    assert access.member_id in _tiers(found)
    assert await reader.list(access.org_id, access.member_id, query="%") == []


@pytest.mark.parametrize("wildcard", ["%", "_"])
async def test_every_picker_search_treats_wildcards_literally(session, access, wildcard):
    groups, total = await GroupOperations(session).list_in_organization(
        access.org_id, access.member_id, search=wildcard
    )
    assert (groups, total) == ([], 0)
    members, total = await OrganizationOperations(session).list_members(
        access.org_id, search=wildcard
    )
    assert (members, total) == ([], 0)


async def test_picker_lists_without_a_search_still_return_everyone(session, access):
    _, groups = await GroupOperations(session).list_in_organization(access.org_id, access.member_id)
    _, members = await OrganizationOperations(session).list_members(access.org_id)
    assert groups > 0 and members > 0


async def test_people_reached_through_an_assigned_group_record_nothing(session, access, monkeypatch):
    emitted: list[NotificationEvent] = []

    async def capture(event):
        emitted.append(event)

    monkeypatch.setattr(task_notifications, "emit_notification", capture)
    task = Task(
        id=generate_id(),
        organization_id=access.org_id,
        owner_id=access.owner_id,
        project_id=generate_id(),
        title="Group work",
        number=1,
    )
    await TaskNotifications(session).emit_assignment_notifications(
        task, access.owner_id, [], [str(access.admin_id), str(access.access_group_id)]
    )
    direct, via_group = emitted
    assert direct.target_user_ids == [access.admin_id] and direct.metadata is None
    assert via_group.target_user_ids == [access.peer_id]
    assert via_group.metadata == {"group_ids": [str(access.access_group_id)]}
    assert await record_notification_interactions(session, via_group, [access.peer_id]) == 0


@pytest.mark.parametrize("private", [False, True])
async def test_nightly_upkeep_requires_current_task_access(session, access, private, monkeypatch):
    monkeypatch.setattr("uniffy.domains.directory.collaborators.jobs.jobs.ACTIVITY_PAGE_SIZE", 1)
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Co-activity",
        slug=f"co-{generate_id().hex[-12:]}",
        access_mode=AccessMode.OWNER_ONLY if private else AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        task_counter=1,
    )
    session.add(project)
    await session.flush()
    tasks = [
        Task(
            organization_id=access.org_id,
            owner_id=access.member_id,
            project_id=project.id,
            title="Shared",
            number=number,
            description="",
        )
        for number in (1, 2)
    ]
    session.add_all(tasks)
    await session.flush()
    session.add_all([
        TaskActivity(task_id=task.id, actor_id=actor, action="title_changed")
        for task in tasks
        for actor in (access.member_id, access.peer_id, access.peer_id)
    ])
    project_id, task_ids = project.id, [task.id for task in tasks]
    await session.commit()
    try:
        now = datetime.now(UTC)
        pairs = []
        async for org_id, batch in _shared_work(session, now - timedelta(days=1), now):
            if org_id == access.org_id:
                assert len(batch) <= 2
                pairs.extend(batch)
        expected = (
            []
            if private
            else [
                (access.member_id, access.peer_id, CollaboratorSignal.CO_ACTIVITY),
                (access.peer_id, access.member_id, CollaboratorSignal.CO_ACTIVITY),
            ]
        )
        assert sorted(pairs) == sorted(expected * len(tasks))
        # Within the cap nothing is pruned; the statement must still run on real PostgreSQL.
        await stage_interactions(session, access.org_id, pairs, at=now)
        await session.commit()
        assert await _prune(session, now) >= 0
        member_view = await CollaboratorReader(session).list(access.org_id, access.member_id)
        if private:
            assert _tiers(member_view)[access.peer_id] is CollaboratorTier.MEMBER
        else:
            assert member_view[0].user.id == access.peer_id
    finally:
        await session.rollback()
        await session.execute(delete(TaskActivity).where(TaskActivity.task_id.in_(task_ids)))
        await session.execute(delete(Task).where(Task.id.in_(task_ids)))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.commit()


class TestAssigneeValidation:
    async def test_accepts_active_members_teams_and_private_groups_the_actor_is_in(
        self, session, access
    ):
        await TaskValidator(session).validate_assignees(
            access.org_id,
            access.member_id,
            [str(access.peer_id), str(access.team_id), str(access.private_group_id)],
            total=3,
        )

    @pytest.mark.parametrize("who", ["outsider_id", "ghost_id", "private_group_id"])
    async def test_rejects_ids_the_actor_may_not_assign(self, session, access, who):
        # The peer is not in the private group, so its roster is not theirs to target.
        with pytest.raises(ValidationError):
            await TaskValidator(session).validate_assignees(
                access.org_id, access.peer_id, [str(getattr(access, who))], total=1
            )

    async def test_rejects_malformed_ids_and_oversized_lists(self, session, access):
        for malformed in ("not-a-uuid", f"{{{access.peer_id}}}", str(access.peer_id).upper()):
            with pytest.raises(ValidationError):
                await TaskValidator(session).validate_assignees(
                    access.org_id, access.member_id, [malformed], total=1
                )
        with pytest.raises(ValidationError):
            await TaskValidator(session).validate_assignees(
                access.org_id, access.member_id, [], total=51
            )

    async def test_a_list_over_the_cap_may_still_shrink(self, session, access):
        await TaskValidator(session).validate_assignees(
            access.org_id, access.member_id, [], total=60, previous_total=61
        )


async def test_active_member_filter_accepts_more_than_the_driver_parameter_limit(session, access):
    candidates = [generate_id() for _ in range(32_767)]
    candidates.extend([access.member_id, access.peer_id, access.ghost_id, access.outsider_id])
    assert await filter_active_members(session, access.org_id, candidates) == {
        access.member_id,
        access.peer_id,
    }
