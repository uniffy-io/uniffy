"""Access-request target mapping and grant-orchestration guards."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ConflictError, RateLimitExceededError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.permissions.resource_access.targets import (
    AccessGrantKind,
    AccessRequestTarget,
    AccessRequestTargetResolver,
)
from uniffy.domains.permissions.resource_access.types import (
    RequestTarget,
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.permissions.access_requests import (
    AccessRequestDecision,
    ContentAccessRequestOperations,
    RequestAccessOutcome,
)


def _request(
    *,
    organization_id=None,
    requester_id=None,
    requested_urn=None,
) -> ContentAccessRequest:
    original_id = generate_id()
    return ContentAccessRequest(
        organization_id=organization_id or generate_id(),
        requester_id=requester_id or generate_id(),
        requested_urn=requested_urn or f"urn:uniffy:content:NOTE:{original_id}",
        original_content_type=ContentType.NOTE,
        original_content_id=original_id,
        canonical_content_type=ContentType.NOTE,
        canonical_content_id=original_id,
        state=ContentAccessRequestState.PENDING,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _standard_target(request: ContentAccessRequest) -> AccessRequestTarget:
    row = SimpleNamespace(
        id=request.canonical_content_id,
        owner_id=generate_id(),
        access_mode=AccessMode.EXPLICIT_MEMBERS,
        baseline_role=None,
    )
    return AccessRequestTarget(
        requested_urn=request.requested_urn,
        original_content_type=request.original_content_type,
        original_content_id=request.original_content_id,
        canonical_content_type=request.canonical_content_type,
        canonical_content_id=request.canonical_content_id,
        grant_kind=AccessGrantKind.STANDARD,
        canonical_row=row,
    )


async def test_task_request_maps_to_project() -> None:
    organization_id = generate_id()
    task_id = generate_id()
    project_id = generate_id()
    project = SimpleNamespace(id=project_id, is_deleted=False)
    session = MagicMock()
    loader = AsyncMock(return_value=project)
    resolver = AccessRequestTargetResolver(session)
    key = ResourceKey(ContentType.TASK, task_id)
    resolver.resources.resolve = AsyncMock(
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=False,
                request_target=RequestTarget(
                    ContentType.PROJECT,
                    project_id,
                    AccessGrantKind.STANDARD,
                ),
            )
        }
    )

    with patch(
        "uniffy.domains.permissions.resource_access.targets.get_content_loader",
        return_value=loader,
    ):
        target = await resolver.resolve(
            organization_id,
            f"urn:uniffy:content:TASK:{task_id}",
            actor_id=generate_id(),
        )

    assert target.original_content_type == ContentType.TASK
    assert target.canonical_content_type == ContentType.PROJECT
    assert target.canonical_content_id == project_id
    assert target.grant_kind == AccessGrantKind.STANDARD
    loader.assert_awaited_once_with(session, organization_id, project_id)


async def test_private_message_request_maps_to_channel() -> None:
    organization_id = generate_id()
    channel = ChatChannel(
        organization_id=organization_id,
        owner_id=generate_id(),
        name="Private",
        slug=f"private-{generate_id()}",
        channel_type=ChannelType.PRIVATE,
    )
    message = ChatMessage(channel_id=channel.id, sender_id=generate_id())
    result = MagicMock()
    result.scalar_one_or_none.return_value = channel
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    resolver = AccessRequestTargetResolver(session)
    key = ResourceKey(ContentType.CHAT_MESSAGE, message.id)
    resolver.resources.resolve = AsyncMock(
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=False,
                request_target=RequestTarget(
                    ContentType.CHAT,
                    channel.id,
                    AccessGrantKind.CHAT,
                ),
            )
        }
    )

    target = await resolver.resolve(
        organization_id,
        f"urn:uniffy:content:CHAT_MESSAGE:{message.id}",
        actor_id=generate_id(),
    )

    assert target.original_content_type == ContentType.CHAT_MESSAGE
    assert target.canonical_content_type == ContentType.CHAT
    assert target.canonical_content_id == channel.id
    assert target.grant_kind == AccessGrantKind.CHAT


@pytest.mark.parametrize("channel_type", [ChannelType.PUBLIC, ChannelType.DIRECT, ChannelType.GROUP_DM])
async def test_non_private_chat_targets_are_rejected(channel_type: ChannelType) -> None:
    channel = ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Unsupported",
        slug=f"unsupported-{generate_id()}",
        channel_type=channel_type,
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = channel
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    resolver = AccessRequestTargetResolver(session)
    key = ResourceKey(ContentType.CHAT, channel.id)
    resolver.resources.resolve = AsyncMock(
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=False,
                request_target=RequestTarget(
                    ContentType.CHAT,
                    channel.id,
                    AccessGrantKind.CHAT,
                ),
            )
        }
    )

    with pytest.raises(ValidationError, match="Only private channels"):
        await resolver.resolve(
            channel.organization_id,
            f"urn:uniffy:content:CHAT:{channel.id}",
            actor_id=generate_id(),
        )


async def test_standard_approval_delegates_mode_and_member_mutations() -> None:
    request = _request()
    target = _standard_target(request)
    target.canonical_row.access_mode = AccessMode.OWNER_ONLY
    session = MagicMock()
    operations = ContentAccessRequestOperations(session)

    checker = MagicMock()
    checker.get_org_defaults = AsyncMock(return_value=(AccessMode.OWNER_ONLY, None))
    members = MagicMock()
    members.set_access_mode = AsyncMock()
    members.add_member = AsyncMock()

    with (
        patch(
            "uniffy.domains.permissions.access_requests.PermissionChecker",
            return_value=checker,
        ),
        patch(
            "uniffy.domains.permissions.access_requests.ContentMembersOperations",
            return_value=members,
        ),
    ):
        await operations._grant_access(
            request,
            target,
            actor_user_id=target.canonical_row.owner_id,
            approved_role=ContentRole.VIEWER,
        )

    members.set_access_mode.assert_awaited_once()
    members.add_member.assert_awaited_once()
    assert members.add_member.await_args.kwargs["subject_id"] == request.requester_id
    assert members.add_member.await_args.kwargs["role"] == ContentRole.VIEWER


async def test_chat_approval_delegates_channel_membership() -> None:
    request = _request()
    channel = SimpleNamespace(id=generate_id())
    target = AccessRequestTarget(
        requested_urn=request.requested_urn,
        original_content_type=ContentType.CHAT_MESSAGE,
        original_content_id=request.original_content_id,
        canonical_content_type=ContentType.CHAT,
        canonical_content_id=channel.id,
        grant_kind=AccessGrantKind.CHAT,
        canonical_row=channel,
    )
    channels = MagicMock()
    channels.add_members = AsyncMock()

    with patch(
        "uniffy.domains.permissions.access_requests.ChatChannelOperations",
        return_value=channels,
    ):
        await ContentAccessRequestOperations(MagicMock())._grant_access(
            request,
            target,
            actor_user_id=generate_id(),
            approved_role=None,
        )

    channels.add_members.assert_awaited_once()
    assert channels.add_members.await_args.args[-1] == [request.requester_id]


async def test_approval_remains_pending_when_grant_does_not_provide_view_access() -> None:
    request = _request()
    target = _standard_target(request)
    session = MagicMock()
    session.commit = AsyncMock()
    operations = ContentAccessRequestOperations(session)
    operations.targets = MagicMock()
    operations.targets.require_active_member = AsyncMock()
    operations.targets.resolve_request = AsyncMock(return_value=target)
    operations.targets.reviewer_can_manage = AsyncMock(return_value=True)
    operations.targets.requester_has_access = AsyncMock(return_value=False)
    operations.queries.get_request = AsyncMock(return_value=request)
    operations._grant_access = AsyncMock()
    operations._close_request = AsyncMock()

    refreshed = MagicMock()
    refreshed.resolve_request = AsyncMock(return_value=target)
    refreshed.requester_has_access = AsyncMock(return_value=False)

    with (
        patch(
            "uniffy.domains.permissions.access_requests.AccessRequestTargetResolver",
            return_value=refreshed,
        ),
        pytest.raises(ConflictError, match="remains pending"),
    ):
        await operations.respond(
            actor_user_id=generate_id(),
            organization_id=request.organization_id,
            request_id=request.id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=ContentRole.VIEWER,
            decision_note="",
        )

    operations._grant_access.assert_awaited_once()
    operations._close_request.assert_not_awaited()
    session.commit.assert_not_awaited()
    assert request.state == ContentAccessRequestState.PENDING


async def test_existing_access_repairs_without_inserting_request() -> None:
    request = _request()
    target = _standard_target(request)
    operations = ContentAccessRequestOperations(MagicMock())
    operations.targets = MagicMock()
    operations.targets.require_active_member = AsyncMock()
    operations.targets.resolve = AsyncMock(return_value=target)
    operations.targets.requester_has_access = AsyncMock(return_value=True)

    result = await operations.request_access(
        requester_id=request.requester_id,
        organization_id=request.organization_id,
        requested_urn=request.requested_urn,
        message="",
    )

    assert result.outcome == RequestAccessOutcome.ALREADY_ACCESSIBLE
    operations.targets.requester_has_access.assert_awaited_once()


async def test_rate_limit_stops_request_before_insert() -> None:
    request = _request()
    target = _standard_target(request)
    session = MagicMock()
    session.execute = AsyncMock()
    operations = ContentAccessRequestOperations(session)
    operations.targets = MagicMock()
    operations.targets.require_active_member = AsyncMock()
    operations.targets.resolve = AsyncMock(return_value=target)
    operations.targets.requester_has_access = AsyncMock(return_value=False)
    operations.queries.pending_request = AsyncMock(return_value=None)
    operations.queries.latest_request = AsyncMock(return_value=None)

    with (
        patch(
            "uniffy.domains.permissions.access_requests.check_rate_limit",
            new=AsyncMock(
                side_effect=RateLimitExceededError(
                    "access requests",
                    10,
                    3600,
                )
            ),
        ),
        pytest.raises(RateLimitExceededError),
    ):
        await operations.request_access(
            requester_id=request.requester_id,
            organization_id=request.organization_id,
            requested_urn=request.requested_urn,
            message="",
        )

    session.execute.assert_not_awaited()


async def test_retry_closes_pending_request_after_independent_grant() -> None:
    request = _request()
    target = _standard_target(request)
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    operations = ContentAccessRequestOperations(session)
    operations.targets = MagicMock()
    operations.targets.require_active_member = AsyncMock()
    operations.targets.resolve_request = AsyncMock(return_value=target)
    operations.targets.reviewer_can_manage = AsyncMock(return_value=True)
    operations.targets.requester_has_access = AsyncMock(return_value=True)
    operations.queries.get_request = AsyncMock(return_value=request)
    operations.queries.view = AsyncMock(
        return_value=SimpleNamespace(
            request=request,
            requester_has_access=True,
        )
    )
    operations._grant_access = AsyncMock()
    operations._write_audit = AsyncMock()

    result = await operations.respond(
        actor_user_id=target.canonical_row.owner_id,
        organization_id=request.organization_id,
        request_id=request.id,
        decision=AccessRequestDecision.APPROVE,
        approved_role=ContentRole.VIEWER,
        decision_note="",
    )

    operations._grant_access.assert_not_awaited()
    assert request.state == ContentAccessRequestState.APPROVED
    assert result.requester_has_access is True
    session.commit.assert_awaited_once()
