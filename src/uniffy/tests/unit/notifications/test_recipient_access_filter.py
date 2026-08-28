"""Recipient permission checks before notification delivery."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.shared import NotificationType
from uniffy.core.types import ContentRole, ContentType, generate_id
from uniffy.domains.permissions.access import AUDIENCE_CONTENT_TYPES
from uniffy.domains.notifications.jobs import jobs as task

ORG = generate_id()
ACTOR = generate_id()
KEPT = generate_id()
DROPPED = generate_id()
NOTE_ID = generate_id()


def _event(**overrides) -> NotificationEvent:
    fields = dict(
        notification_type=NotificationType.CONTENT_MENTIONED,
        organization_id=ORG,
        actor_id=ACTOR,
        title="Mentioned you in: Q4 restructure",
        source_urn=f"urn:uniffy:content:NOTE:{NOTE_ID}",
    )
    fields.update(overrides)
    return NotificationEvent(**fields)


def _roles(mapping):
    async def fake(*_args, candidate_user_ids, **_kwargs):
        return [
            user_id
            for user_id in candidate_user_ids
            if mapping.get(user_id) not in (None, ContentRole.BLOCKED)
        ]

    return patch.object(
        task.ResourceAudienceResolver,
        "filter_resource",
        new=AsyncMock(side_effect=fake),
    )


def _active(*user_ids):
    return patch.object(
        task.ResourceAudienceResolver,
        "active_roles",
        new=AsyncMock(return_value={user_id: MagicMock() for user_id in user_ids}),
    )


async def test_explicit_recipients_without_view_access_are_dropped() -> None:
    """The notes mention producer passes its target list straight through."""
    session = MagicMock()
    event = _event(target_user_ids=[KEPT, DROPPED])

    with _roles({KEPT: ContentRole.VIEWER, DROPPED: None}):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


async def test_a_blocked_recipient_is_dropped() -> None:
    """BLOCKED beats a baseline the note still carries."""
    session = MagicMock()
    event = _event(target_user_ids=[KEPT, DROPPED])

    with _roles({KEPT: ContentRole.VIEWER, DROPPED: ContentRole.BLOCKED}):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


async def test_the_actor_is_still_excluded() -> None:
    session = MagicMock()
    event = _event(target_user_ids=[ACTOR, KEPT])

    with _roles({ACTOR: ContentRole.OWNER, KEPT: ContentRole.VIEWER}):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


async def test_events_without_content_are_left_alone() -> None:
    """Support-session and other contentless events have nothing to check."""
    session = MagicMock()
    event = _event(source_urn=None, target_user_ids=[KEPT, DROPPED])

    with _active(KEPT, DROPPED):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT, DROPPED]


async def test_access_request_denial_metadata_does_not_trigger_source_filter() -> None:
    event = _event(
        notification_type=NotificationType.ACCESS_REQUEST_DENIED,
        source_urn=None,
        target_user_ids=[KEPT],
        metadata={
            "request_id": str(generate_id()),
            "requested_urn": f"urn:uniffy:content:NOTE:{NOTE_ID}",
        },
    )

    with _active(KEPT):
        out = await task._resolve_recipients(MagicMock(), event)

    assert out == [KEPT]


async def test_access_revocation_reaches_the_former_viewer() -> None:
    event = _event(
        notification_type=NotificationType.PERMISSION_REVOKED,
        source_urn=None,
        target_user_ids=[KEPT],
        title="Your access was removed",
    )

    with _active(KEPT):
        out = await task._resolve_recipients(MagicMock(), event)

    assert out == [KEPT]


async def test_an_unsupported_content_type_is_dropped() -> None:
    session = MagicMock()
    event = _event(
        source_urn=f"urn:uniffy:content:TAG:{generate_id()}",
        target_user_ids=[KEPT, DROPPED],
    )

    with _roles({}):
        out = await task._resolve_recipients(session, event)

    assert out == []


async def test_bookmarkers_who_lost_access_are_dropped() -> None:
    """The D1 chain: a bookmark outlives the grant that justified it, and
    nothing outside the bookmarks domain ever deletes the row.
    """
    session = MagicMock()
    bookmark_rows = MagicMock(all=lambda: [(DROPPED,), (KEPT,)])
    owner_result = MagicMock(scalar_one_or_none=lambda: ACTOR)
    session.execute = AsyncMock(side_effect=[owner_result, bookmark_rows])

    event = _event(
        notification_type=NotificationType.CONTENT_EDITED,
        title="Edited note: Q4 restructure - engineering 40% cut",
        content_type=ContentType.NOTE,
        content_id=NOTE_ID,
    )

    with _roles({KEPT: ContentRole.VIEWER, DROPPED: None}):
        out = await task._resolve_recipients(session, event)

    bookmark_query = session.execute.await_args_list[1].args[0]
    assert ORG in bookmark_query.compile().params.values()
    assert out == [KEPT]


async def test_system_announcements_skip_deactivated_members() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(all=lambda: [(KEPT,)]))
    event = _event(
        notification_type=NotificationType.SYSTEM_ANNOUNCEMENT,
        source_urn=None,
        title="Scheduled maintenance",
    )

    out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


@pytest.mark.parametrize(
    "content_type",
    [
        ContentType.NOTE,
        ContentType.PROJECT,
        ContentType.TASK,
        ContentType.CALENDAR_EVENT,
        ContentType.FILE,
        ContentType.FOLDER,
    ],
)
def test_the_worker_can_resolve_notified_content_types(content_type) -> None:
    assert content_type in AUDIENCE_CONTENT_TYPES
