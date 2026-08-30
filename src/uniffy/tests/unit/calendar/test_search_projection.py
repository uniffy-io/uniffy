from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.types import EventVisibility, generate_id
from uniffy.domains.calendar import search as search_projection


async def test_private_event_projection_does_not_publish_display_state() -> None:
    event = SimpleNamespace(
        organization_id=generate_id(),
        urn="urn:uniffy:content:CALENDAR_EVENT:01900000-0000-7000-8000-000000000003",
        title="Private title",
        visibility=EventVisibility.PRIVATE,
    )
    operations = MagicMock()
    operations._index_for_search = AsyncMock(return_value={"location": "Private room"})
    publish = AsyncMock()

    with (
        patch.object(search_projection, "CalendarEventOperations", return_value=operations),
        patch.object(search_projection, "publish_mention_state", publish),
    ):
        await search_projection.refresh_event_search_projection(AsyncMock(), event, MagicMock())

    operations._index_for_search.assert_awaited_once_with(event)
    publish.assert_not_awaited()
