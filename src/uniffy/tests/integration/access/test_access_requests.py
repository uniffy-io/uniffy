"""Persisted access-request lifecycle against PostgreSQL and canonical permission operations."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.search_acl_refresh import ProjectSearchAclRefresh
from uniffy.core.models.projects.task import Task
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.infrastructure.database import open_session
from uniffy.domains.notes.reader import NoteReader
from uniffy.domains.permissions.requests.operations import (
    AccessRequestDecision,
    ContentAccessRequestOperations,
    RequestAccessOutcome,
)
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.projects.jobs import jobs as project_search_acl
from uniffy.domains.projects.operations import TaskReader
from uniffy.domains.projects.search.access import record_project_search_acl_refresh

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _note_urn(note_id) -> str:
    return f"urn:uniffy:content:NOTE:{note_id}"


def _operations(session: AsyncSession) -> ContentAccessRequestOperations:
    return ContentAccessRequestOperations(session, MagicMock(spec=SearchIndexer))


async def test_owner_approval_uses_canonical_member_operations(session, access) -> None:
    operations = _operations(session)
    urn = _note_urn(access.private_note_id)

    with pytest.raises(PermissionDeniedError):
        await NoteReader(session).get_by_id(
            access.peer_id,
            access.org_id,
            access.private_note_id,
        )

    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=urn,
        message="Please share this with me.",
    )
    assert created.outcome == RequestAccessOutcome.CREATED
    assert created.view is not None
    request_id = created.view.request.id

    duplicate = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=urn,
        message="A duplicate must converge.",
    )
    assert duplicate.outcome == RequestAccessOutcome.ALREADY_PENDING
    assert duplicate.view is not None
    assert duplicate.view.request.id == request_id

    statuses = await operations.get_my_statuses(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urns=[urn],
    )
    assert statuses[0].state == ContentAccessRequestState.PENDING
    assert statuses[0].request_id == request_id

    pending_page = await operations.list_access_requests(
        actor_user_id=access.member_id,
        organization_id=access.org_id,
        canonical_content_type=ContentType.NOTE,
        canonical_content_id=access.private_note_id,
        state=ContentAccessRequestState.PENDING,
        page=1,
        page_size=20,
    )
    assert pending_page.total_items == 1
    assert pending_page.requests[0].request.id == request_id

    with pytest.raises(PermissionDeniedError):
        await operations.list_access_requests(
            actor_user_id=access.admin_id,
            organization_id=access.org_id,
            canonical_content_type=ContentType.NOTE,
            canonical_content_id=access.private_note_id,
            state=ContentAccessRequestState.PENDING,
            page=1,
            page_size=20,
        )

    approved = await operations.respond(
        actor_user_id=access.member_id,
        organization_id=access.org_id,
        request_id=request_id,
        decision=AccessRequestDecision.APPROVE,
        approved_role=ContentRole.VIEWER,
        decision_note="Approved for the project.",
    )
    assert approved.request.state == ContentAccessRequestState.APPROVED
    assert approved.requester_has_access is True

    approved_statuses = await operations.get_my_statuses(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urns=[urn],
    )
    assert approved_statuses[0].state == ContentAccessRequestState.APPROVED
    assert approved_statuses[0].requester_has_access is True

    note = await NoteReader(session).get_by_id(
        access.peer_id,
        access.org_id,
        access.private_note_id,
    )
    assert note.id == access.private_note_id

    member = (
        await session.execute(
            select(ContentMember).where(
                ContentMember.organization_id == access.org_id,
                ContentMember.content_type == ContentType.NOTE,
                ContentMember.content_id == access.private_note_id,
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id == access.peer_id,
            )
        )
    ).scalar_one()
    assert member.role == ContentRole.VIEWER

    await ContentMembersOperations(session, operations.search_indexer).remove_member(
        actor_user_id=access.member_id,
        organization_id=access.org_id,
        content_type=ContentType.NOTE,
        content_id=access.private_note_id,
        subject_type=SubjectType.USER,
        subject_id=access.peer_id,
    )
    revoked_statuses = await operations.get_my_statuses(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urns=[urn],
    )
    assert revoked_statuses[0].state == ContentAccessRequestState.APPROVED
    assert revoked_statuses[0].requester_has_access is False

    requested_again = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=urn,
        message="Access was revoked, so a new request is valid.",
    )
    assert requested_again.outcome == RequestAccessOutcome.CREATED
    assert requested_again.view is not None
    assert requested_again.view.request.id != request_id

    actions = set(
        (
            await session.execute(
                select(AuditEvent.action).where(
                    AuditEvent.organization_id == access.org_id,
                    AuditEvent.resource_id == access.private_note_id,
                )
            )
        ).scalars()
    )
    assert Action.PERMISSIONS_ACCESS_REQUESTED in actions
    assert Action.PERMISSIONS_ACCESS_REQUEST_APPROVED in actions
    assert Action.PERMISSIONS_MEMBER_ADDED in actions


async def test_approval_rolls_back_grant_when_request_audit_fails(session, access) -> None:
    operations = _operations(session)
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=_note_urn(access.private_note_id),
        message="",
    )
    assert created.view is not None
    request_id = created.view.request.id

    with (
        patch.object(
            operations,
            "_write_audit",
            new=AsyncMock(side_effect=RuntimeError("audit unavailable")),
        ),
        pytest.raises(RuntimeError, match="audit unavailable"),
    ):
        await operations.respond(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            request_id=request_id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=ContentRole.VIEWER,
            decision_note="",
        )

    async with open_session() as isolated:
        request = await isolated.get(ContentAccessRequest, request_id)
        member = (
            await isolated.execute(
                select(ContentMember).where(
                    ContentMember.organization_id == access.org_id,
                    ContentMember.content_type == ContentType.NOTE,
                    ContentMember.content_id == access.private_note_id,
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == access.peer_id,
                )
            )
        ).scalar_one_or_none()
        note = await isolated.get(NoteReader.model_class, access.private_note_id)

    assert request is not None
    assert request.state == ContentAccessRequestState.PENDING
    assert member is None
    assert note is not None
    assert note.access_mode == AccessMode.OWNER_ONLY


async def test_approval_survives_post_commit_fanout_failure(session, access) -> None:
    operations = _operations(session)
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=_note_urn(access.private_note_id),
        message="",
    )
    assert created.view is not None
    request_id = created.view.request.id

    with patch.object(
        operations,
        "_finish_access_grant_after_commit",
        new=AsyncMock(side_effect=RuntimeError("projection unavailable")),
    ):
        approved = await operations.respond(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            request_id=request_id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=ContentRole.VIEWER,
            decision_note="",
        )

    assert approved.request.state == ContentAccessRequestState.APPROVED
    async with open_session() as isolated:
        request = await isolated.get(ContentAccessRequest, request_id)
        member = (
            await isolated.execute(
                select(ContentMember).where(
                    ContentMember.organization_id == access.org_id,
                    ContentMember.content_type == ContentType.NOTE,
                    ContentMember.content_id == access.private_note_id,
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == access.peer_id,
                )
            )
        ).scalar_one_or_none()

    assert request is not None
    assert request.state == ContentAccessRequestState.APPROVED
    assert member is not None
    assert member.role == ContentRole.VIEWER


async def test_org_admin_cannot_review_private_standard_content(session, access) -> None:
    operations = _operations(session)
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=_note_urn(access.private_note_id),
        message="",
    )
    assert created.view is not None

    with pytest.raises(PermissionDeniedError):
        await operations.respond(
            actor_user_id=access.admin_id,
            organization_id=access.org_id,
            request_id=created.view.request.id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=ContentRole.VIEWER,
            decision_note="",
        )


async def test_requester_cannot_approve_their_own_request(session, access) -> None:
    operations = _operations(session)
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=_note_urn(access.private_note_id),
        message="",
    )
    assert created.view is not None

    with pytest.raises(PermissionDeniedError):
        await operations.respond(
            actor_user_id=access.peer_id,
            organization_id=access.org_id,
            request_id=created.view.request.id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=ContentRole.VIEWER,
            decision_note="",
        )


async def test_denial_enforces_cooldown_and_cancel_is_idempotent(session, access) -> None:
    operations = _operations(session)
    urn = _note_urn(access.private_note_id)
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=urn,
        message="",
    )
    assert created.view is not None

    denied = await operations.respond(
        actor_user_id=access.member_id,
        organization_id=access.org_id,
        request_id=created.view.request.id,
        decision=AccessRequestDecision.DENY,
        approved_role=None,
        decision_note="Not yet.",
    )
    assert denied.request.state == ContentAccessRequestState.DENIED
    assert denied.can_request_again_at is not None

    cooldown = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=urn,
        message="",
    )
    assert cooldown.outcome == RequestAccessOutcome.COOLDOWN
    assert cooldown.can_request_again_at is not None

    other_urn = _note_urn(access.shared_note_id)
    pending = await operations.request_access(
        requester_id=access.admin_id,
        organization_id=access.org_id,
        requested_urn=other_urn,
        message="",
    )
    assert pending.view is not None
    canceled = await operations.cancel(
        requester_id=access.admin_id,
        organization_id=access.org_id,
        request_id=pending.view.request.id,
    )
    repeated = await operations.cancel(
        requester_id=access.admin_id,
        organization_id=access.org_id,
        request_id=pending.view.request.id,
    )
    assert canceled.request.state == ContentAccessRequestState.CANCELED
    assert repeated.request.state == ContentAccessRequestState.CANCELED


async def test_membership_and_organization_scope_are_required(session, access) -> None:
    operations = _operations(session)
    urn = _note_urn(access.private_note_id)

    with pytest.raises(PermissionDeniedError):
        await operations.request_access(
            requester_id=access.ghost_id,
            organization_id=access.org_id,
            requested_urn=urn,
            message="",
        )
    with pytest.raises(PermissionDeniedError):
        await operations.request_access(
            requester_id=access.outsider_id,
            organization_id=access.org_id,
            requested_urn=urn,
            message="",
        )

    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=urn,
        message="",
    )
    assert created.view is not None
    with pytest.raises(NotFoundError):
        await operations.get_access_request(
            actor_user_id=access.outsider_id,
            organization_id=access.other_org_id,
            request_id=created.view.request.id,
        )


async def test_already_accessible_content_does_not_create_a_request(session, access) -> None:
    result = await _operations(session).request_access(
        requester_id=access.member_id,
        organization_id=access.org_id,
        requested_urn=_note_urn(access.private_note_id),
        message="",
    )
    assert result.outcome == RequestAccessOutcome.ALREADY_ACCESSIBLE
    assert result.view is None


async def test_task_request_grants_its_canonical_project(session, access) -> None:
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        access_mode=AccessMode.OWNER_ONLY,
        name="Restricted project",
        slug=f"RP{str(access.private_note_id)[:3].upper()}",
    )
    session.add(project)
    await session.flush()
    task = Task(
        project_id=project.id,
        organization_id=access.org_id,
        owner_id=access.member_id,
        title="Restricted task",
    )
    session.add(task)
    await session.commit()

    operations = _operations(session)
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=f"urn:uniffy:content:TASK:{task.id}",
        message="",
    )
    assert created.view is not None
    assert created.view.request.original_content_type == ContentType.TASK
    assert created.view.request.canonical_content_type == ContentType.PROJECT
    assert created.view.request.canonical_content_id == project.id

    duplicate = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=f"urn:uniffy:content:PROJECT:{project.id}",
        message="",
    )
    assert duplicate.outcome == RequestAccessOutcome.ALREADY_PENDING
    assert duplicate.view is not None
    assert duplicate.view.request.id == created.view.request.id

    approved = await operations.respond(
        actor_user_id=access.member_id,
        organization_id=access.org_id,
        request_id=created.view.request.id,
        decision=AccessRequestDecision.APPROVE,
        approved_role=ContentRole.VIEWER,
        decision_note="",
    )
    assert approved.request.state == ContentAccessRequestState.APPROVED
    visible_task = await TaskReader(session).get_by_id(
        access.peer_id,
        access.org_id,
        task.id,
    )
    assert visible_task.id == task.id


async def test_concurrent_duplicate_requests_create_one_pending_row(session, access) -> None:
    urn = _note_urn(access.private_note_id)
    notifier = MagicMock()
    notifier.notify_requested = AsyncMock()
    notifier.publish_state = AsyncMock()

    async def submit():
        async with open_session() as isolated:
            return await _operations(isolated).request_access(
                requester_id=access.peer_id,
                organization_id=access.org_id,
                requested_urn=urn,
                message="Concurrent request",
            )

    with patch(
        "uniffy.domains.permissions.requests.operations.AccessRequestNotifier",
        return_value=notifier,
    ):
        first, second = await asyncio.gather(submit(), submit())
    assert {first.outcome, second.outcome} == {
        RequestAccessOutcome.CREATED,
        RequestAccessOutcome.ALREADY_PENDING,
    }
    assert first.view is not None
    assert second.view is not None
    assert first.view.request.id == second.view.request.id

    request_count = (
        await session.execute(
            select(func.count())
            .select_from(ContentAccessRequest)
            .where(
                ContentAccessRequest.organization_id == access.org_id,
                ContentAccessRequest.requester_id == access.peer_id,
                ContentAccessRequest.canonical_content_type == ContentType.NOTE,
                ContentAccessRequest.canonical_content_id == access.private_note_id,
                ContentAccessRequest.state == ContentAccessRequestState.PENDING,
            )
        )
    ).scalar_one()
    requested_audits = (
        await session.execute(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                AuditEvent.organization_id == access.org_id,
                AuditEvent.action == Action.PERMISSIONS_ACCESS_REQUESTED,
                AuditEvent.resource_id == access.private_note_id,
            )
        )
    ).scalar_one()
    assert request_count == 1
    assert requested_audits == 1
    notifier.notify_requested.assert_awaited_once()
    notifier.publish_state.assert_awaited_once()


async def test_project_acl_refresh_is_versioned_and_projects_current_policy(session, access) -> None:
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Search ACL project",
        slug=f"acl-{str(access.member_id)[:6]}",
        access_mode=AccessMode.EXPLICIT_MEMBERS,
    )
    session.add(project)
    await session.commit()
    session.add(
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
            added_by_user_id=access.member_id,
        )
    )
    await record_project_search_acl_refresh(session, access.org_id, project.id)
    await record_project_search_acl_refresh(session, access.org_id, project.id)
    await session.commit()

    queued = await session.get(ProjectSearchAclRefresh, project.id)
    assert queued is not None
    assert queued.version == 2

    search = MagicMock()
    search.update_task_sharing = AsyncMock(return_value=3)
    result = await project_search_acl._process_project(project.id, search)

    assert result == {"status": "complete", "updated": 3}
    search.update_task_sharing.assert_awaited_once()
    kwargs = search.update_task_sharing.await_args.kwargs
    assert kwargs["organization_id"] == access.org_id
    assert kwargs["project_id"] == project.id
    assert kwargs["owner_id"] == access.member_id
    assert kwargs["access_mode"] == AccessMode.EXPLICIT_MEMBERS.value
    assert kwargs["shared_user_ids"] == [access.peer_id]
    remaining = (
        await session.execute(
            select(func.count())
            .select_from(ProjectSearchAclRefresh)
            .where(ProjectSearchAclRefresh.project_id == project.id)
        )
    ).scalar_one()
    assert remaining == 0
