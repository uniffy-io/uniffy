"""Order cursor mutations independently of their movable message position."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.dialects.postgresql import Insert, insert
from valkey.asyncio import Redis

from uniffy.core.models.chat.read_cursor import ChatReadCursor
from uniffy.infrastructure.valkey.ops import ops_call

EPOCH = datetime(1, 1, 1, tzinfo=UTC)
CURSOR_KEY = "chat:channel_cursor:{user_id}:{channel_id}"
DIRTY_CURSORS = "chat:dirty_channel_cursors"
CURSOR_TTL = 7 * 24 * 3600

_WRITE_CURSOR = """
local current = redis.call('GET', KEYS[1])
if current and string.sub(current, 1, 36) >= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
return 1
"""

_CLEAN_CURSORS = """
for i = 2, #KEYS do
    local current = redis.call('GET', KEYS[i])
    if (current or '') == ARGV[(i - 2) * 2 + 1] then
        redis.call('SREM', KEYS[1], ARGV[(i - 2) * 2 + 2])
    end
end
return 1
"""


@dataclass(frozen=True)
class ChannelCursor:
    revision: UUID
    message_id: UUID | None
    read_at: datetime

    def encode(self) -> str:
        return f"{self.revision}:{self.message_id or ''}:{self.read_at.isoformat()}"

    @classmethod
    def decode(cls, raw: str) -> ChannelCursor:
        revision, message_id, read_at = raw.split(":", 2)
        return cls(
            UUID(revision), UUID(message_id) if message_id else None, datetime.fromisoformat(read_at)
        )

    def row(self, user_id: UUID, channel_id: UUID) -> dict[str, UUID | datetime | None]:
        return {
            "channel_id": channel_id,
            "user_id": user_id,
            "revision": self.revision,
            "last_read_message_id": self.message_id,
            "last_read_at": self.read_at,
        }


async def cache_cursor(
    client: Redis, user_id: UUID, channel_id: UUID, cursor: ChannelCursor
) -> None:
    key = CURSOR_KEY.format(user_id=user_id, channel_id=channel_id)
    async with ops_call("chat", "cursor_write"):
        await client.eval(
            _WRITE_CURSOR,
            2,
            key,
            DIRTY_CURSORS,
            str(cursor.revision),
            cursor.encode(),
            CURSOR_TTL,
            f"{user_id}:{channel_id}",
        )


async def warm_cursor(client: Redis, user_id: UUID, channel_id: UUID, cursor: ChannelCursor) -> None:
    async with ops_call("chat", "cursor_warm"):
        await client.set(
            CURSOR_KEY.format(user_id=user_id, channel_id=channel_id),
            cursor.encode(),
            ex=CURSOR_TTL,
            nx=True,
        )


async def clean_cursors(client: Redis, snapshots: list[tuple[str, str, str]]) -> None:
    if not snapshots:
        return
    async with ops_call("chat", "cursor_clean"):
        await client.eval(
            _CLEAN_CURSORS,
            len(snapshots) + 1,
            DIRTY_CURSORS,
            *(key for key, _, _ in snapshots),
            *(value for _, raw, member in snapshots for value in (raw, member)),
        )


def upsert_cursors(rows: list[dict[str, UUID | datetime | None]]) -> Insert:
    stmt = insert(ChatReadCursor).values(rows)
    return stmt.on_conflict_do_update(
        index_elements=["channel_id", "user_id"],
        set_={
            "last_read_message_id": stmt.excluded.last_read_message_id,
            "last_read_at": stmt.excluded.last_read_at,
            "revision": stmt.excluded.revision,
        },
        where=ChatReadCursor.revision < stmt.excluded.revision,
    )
