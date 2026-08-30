from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.domains.chat.channels.handlers import ChannelHandlers
from uniffy.domains.search.queries import UrnAvailability


async def test_resource_titles_include_only_authorized_previews() -> None:
    available_urn = f"urn:uniffy:content:NOTE:{uuid4()}"
    restricted_urn = f"urn:uniffy:content:NOTE:{uuid4()}"
    resolved = {
        available_urn: SimpleNamespace(
            availability=UrnAvailability.AVAILABLE,
            title="Visible note",
        ),
        restricted_urn: SimpleNamespace(
            availability=UrnAvailability.RESTRICTED,
            title="Private title from stale preview",
        ),
    }

    with patch(
        "uniffy.domains.chat.channels.handlers.SearchOperations.resolve_urns",
        AsyncMock(return_value=resolved),
    ) as resolve:
        handlers = ChannelHandlers()
        handlers.search_indexer = MagicMock()
        titles = await handlers._resolve_resource_titles(
            AsyncMock(),
            [SimpleNamespace(urn=available_urn), SimpleNamespace(urn=restricted_urn)],
            uuid4(),
            uuid4(),
        )

    assert titles == {available_urn: "Visible note"}
    resolve.assert_awaited_once()
