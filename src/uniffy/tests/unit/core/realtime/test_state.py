import asyncio

import pytest

from uniffy.core.realtime.state import OutboundQueue


async def test_outbound_byte_budget_reclaims_drained_bytes():
    queue = OutboundQueue(max_bytes=10)
    queue.put_nowait(b"12345678")
    with pytest.raises(asyncio.QueueFull):
        queue.put_nowait(b"abc")
    assert await queue.get() == b"12345678"
    await queue.put(b"abcdefghij")
    assert queue.queued_bytes == 10
    with pytest.raises(asyncio.QueueFull):
        await queue.put(b"too many bytes")
