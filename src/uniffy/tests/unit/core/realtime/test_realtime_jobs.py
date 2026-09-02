import base64
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.realtime.jobs import save_realtime_snapshot
from uniffy.core.types import ContentType, generate_id


async def test_save_realtime_snapshot_decodes_payload_and_renders() -> None:
    content_id = generate_id()
    organization_id = generate_id()
    persist = AsyncMock(return_value=True)
    duration = MagicMock()

    with (
        patch("uniffy.core.realtime.jobs.persist_snapshot", persist),
        patch("uniffy.core.realtime.jobs.REALTIME_SNAPSHOT_TASK_DURATION", duration),
    ):
        result = await save_realtime_snapshot(
            {},
            ContentType.NOTE.value,
            str(content_id),
            str(organization_id),
            base64.b64encode(b"update").decode("ascii"),
            base64.b64encode(b"state").decode("ascii"),
        )

    persist.assert_awaited_once_with(
        ContentType.NOTE,
        content_id,
        organization_id,
        b"update",
        b"state",
    )
    duration.labels.assert_called_once_with(content_type=ContentType.NOTE.value)
    duration.labels.return_value.observe.assert_called_once()
    assert result == {"status": "ok", "content_id": str(content_id)}


async def test_save_realtime_snapshot_reports_missing_adapter() -> None:
    content_id = generate_id()
    persist = AsyncMock(return_value=False)

    with patch("uniffy.core.realtime.jobs.persist_snapshot", persist):
        result = await save_realtime_snapshot(
            {},
            ContentType.NOTE.value,
            str(content_id),
            str(generate_id()),
            base64.b64encode(b"update").decode("ascii"),
            base64.b64encode(b"state").decode("ascii"),
        )

    assert result == {"status": "snapshot_only", "content_id": str(content_id)}
