"""Recipients are checked for view access before delivery.

Notification titles carry content ("Edited note: Q4 restructure"), so
delivering to someone who lost access is a disclosure. Neither recipient
path was checked before: the resolved path is built from ownership and
bookmarks, and nothing cleans a bookmark when access is revoked; the
explicit path is only as gated as its producer, and the notes mention
producer does no check at all.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.shared import NotificationType
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.workers.tasks import notifications as task

ORG = generate_id()
ACTOR = generate_id()
KEPT = generate_id()
DROPPED = generate_id()
NOTE_ID = generate_id()


def _note_row(owner_id=ACTOR):
    return MagicMock(
        owner_id=owner_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )


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
    """Patch effective_role to a fixed per-user verdict."""

    async def fake(user_id, *_a, **_k):
        return mapping.get(user_id)

    return patch(
        "uniffy.workers.tasks.notifications.PermissionChecker.effective_role",
        AsyncMock(side_effect=fake),
    )


def _loader(row):
    return patch.object(
        task,
        "_load_access_policy",
        AsyncMock(return_value=(ContentType.NOTE, NOTE_ID, row) if row else None),
    )


async def test_explicit_recipients_without_view_access_are_dropped() -> None:
    """The notes mention producer passes its target list straight through."""
    session = MagicMock()
    event = _event(target_user_ids=[KEPT, DROPPED])

    with _loader(_note_row()), _roles({KEPT: ContentRole.VIEWER, DROPPED: None}):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


async def test_a_blocked_recipient_is_dropped() -> None:
    """BLOCKED beats a baseline the note still carries."""
    session = MagicMock()
    event = _event(target_user_ids=[KEPT, DROPPED])

    with _loader(_note_row()), _roles(
        {KEPT: ContentRole.VIEWER, DROPPED: ContentRole.BLOCKED}
    ):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


async def test_the_actor_is_still_excluded() -> None:
    session = MagicMock()
    event = _event(target_user_ids=[ACTOR, KEPT])

    with _loader(_note_row()), _roles({ACTOR: ContentRole.OWNER, KEPT: ContentRole.VIEWER}):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT]


async def test_events_without_content_are_left_alone() -> None:
    """Support-session and other contentless events have nothing to check."""
    session = MagicMock()
    event = _event(source_urn=None, target_user_ids=[KEPT, DROPPED])

    out = await task._resolve_recipients(session, event)

    assert out == [KEPT, DROPPED]


async def test_an_undecidable_content_type_is_left_alone() -> None:
    """Chat channels carry their own access model; dropping those
    notifications would be a functional regression, so the filter abstains
    and counts a metric instead.
    """
    session = MagicMock()
    event = _event(
        source_urn=f"urn:uniffy:content:CHAT_CHANNEL:{generate_id()}",
        target_user_ids=[KEPT, DROPPED],
    )

    with _loader(None):
        out = await task._resolve_recipients(session, event)

    assert out == [KEPT, DROPPED]


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

    with _loader(_note_row()), _roles({KEPT: ContentRole.VIEWER, DROPPED: None}):
        out = await task._resolve_recipients(session, event)

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
def test_the_worker_can_resolve_a_policy_for_notified_content_types(content_type) -> None:
    """Loaders register as an import side effect, and the worker's own import
    chain pulls in only some of them. Without the explicit import the filter
    would silently abstain on most content.
    """
    from uniffy.core.content.members import find_content_loader

    task._ensure_content_loaders()
    assert find_content_loader(content_type) is not None
