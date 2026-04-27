"""Auto-unmute cron job for timed channel mutes."""

from datetime import UTC, datetime
from typing import Any

from loguru import logger
from sqlalchemy import update

from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.db import open_session


async def auto_unmute_channels(ctx: dict[str, Any]) -> dict[str, Any]:
    """Unmute channels where muted_until has expired.

    Runs as an ARQ cron job every minute. Bulk-updates all expired
    timed mutes in a single query.

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary.

    Returns
    -------
    dict
        Result with unmuted count.

    """
    now = datetime.now(UTC)
    count = 0
    async with open_session() as session:
        result = await session.execute(
            update(ChatChannelMember)
            .where(
                ChatChannelMember.is_muted == True,  # noqa: E712
                ChatChannelMember.muted_until.isnot(None),
                ChatChannelMember.muted_until < now,
            )
            .values(is_muted=False, muted_until=None)
        )
        count = result.rowcount
        await session.commit()

    if count > 0:
        logger.info(f"Auto-unmuted {count} channel memberships")
    return {"status": "success", "unmuted": count}
